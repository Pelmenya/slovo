import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import Redis from 'ioredis';
import { sanitizeError } from '@slovo/common';
import { PrismaService } from '@slovo/database';
import {
    ENDPOINTS,
    FlowiseClient,
    formatFlowiseError,
    type TFlowiseDocumentStore,
} from '@slovo/flowise-client';
import { StorageService } from '@slovo/storage';
import {
    CATALOG_AQUAPHOR_STORE_NAME,
    CATALOG_PAYLOAD_KEY,
    CATALOG_REFRESH_CRON,
    CATALOG_REFRESH_LOCK_KEY,
    CATALOG_REFRESH_LOCK_RELEASE_LUA,
    CATALOG_REFRESH_LOCK_TTL_SEC,
    CATALOG_SPLITTER_CHUNK_OVERLAP,
    CATALOG_SPLITTER_CHUNK_SIZE,
    CATALOG_UPSERT_CONCURRENCY,
    FLOWISE_CLIENT_TOKEN,
    REDIS_CLIENT_TOKEN,
} from './catalog-refresh.constants';
import {
    bulkIngestPayloadSchema,
    type TBulkIngestItem,
    type TBulkIngestPayload,
} from './t-bulk-ingest-payload';
import type {
    TCatalogRefreshResult,
    TFindStoreResult,
} from './t-catalog-refresh';

// =============================================================================
// CatalogRefreshService — slovo-orchestrate ingest pipeline (PR6.5).
//
// Раньше (PR6) call'ил `flowise_docstore_refresh` который через S3 File Loader
// тянул latest.json и обрабатывал его как plain text — Custom Metadata
// jsonpointer'ы не извлекались, в metadata оседали литералы вроде "/name".
// Это ломало `/catalog/search/text` enrichment (см. lab journal day 2).
//
// Теперь — slovo читает payload сам и upsert'ит per-item через PlainText
// loader с явной structured metadata. Vector store + embedding configs
// наследуются из store entity (один read на refresh). Distributed lock
// (Redis SET NX EX + Lua-CAS) — без изменений из PR6.
//
// Pipeline:
// 1. Acquire lock (uuid fence-token)
// 2. Resolve storeId by name — Flowise list stores → find by name
// 3. Fetch full store config (vectorStoreConfig, embeddingConfig)
// 4. Wipe existing loaders (старый S3 + предыдущие PlainText) — clean slate
// 5. Download latest.json (StorageService.getObjectStream + utf-8 decode)
// 6. Parse + zod-validate (TBulkIngestPayload)
// 7. Per-item upsert PlainText (concurrency=5)
// 8. Release lock (Lua-CAS with same uuid)
// =============================================================================

type TStoreConfigs = {
    vectorStore: { name: string; config: Record<string, unknown> };
    embedding: { name: string; config: Record<string, unknown> };
};

type TUpsertOutcome =
    | { ok: true; externalId: string }
    | { ok: false; externalId: string; error: string };

@Injectable()
export class CatalogRefreshService implements OnModuleDestroy {
    private readonly logger = new Logger(CatalogRefreshService.name);
    private currentLockToken: string | null = null;

    constructor(
        @Inject(FLOWISE_CLIENT_TOKEN) private readonly flowise: FlowiseClient,
        @Inject(REDIS_CLIENT_TOKEN) private readonly redis: Redis,
        private readonly storage: StorageService,
        private readonly prisma: PrismaService,
    ) {}

    async onModuleDestroy(): Promise<void> {
        if (this.currentLockToken !== null) {
            try {
                await this.releaseLock(this.currentLockToken);
            } catch (error) {
                this.logger.warn(
                    `failed to release lock on shutdown: ${sanitizeError(error)}`,
                );
            }
        }
        try {
            await this.redis.quit();
        } catch (error) {
            this.logger.warn(`redis.quit() failed (degraded shutdown): ${sanitizeError(error)}`);
        }
    }

    @Cron(CATALOG_REFRESH_CRON, { name: 'catalog-refresh' })
    async runScheduled(): Promise<void> {
        const result = await this.refresh();
        if (result.kind === 'success') {
            this.logger.log(
                `catalog-refresh completed: store=${result.storeName} ` +
                    `items=${result.itemsUpserted}/${result.itemsAttempted} ` +
                    `failed=${result.itemsFailed} wiped=${result.loadersWiped} elapsed=${result.elapsedMs}ms`,
            );
        } else if (result.kind === 'skipped') {
            this.logger.warn(
                `catalog-refresh skipped: reason=${result.reason}${result.error ? ` error=${result.error}` : ''}`,
            );
        } else {
            this.logger.error(
                `catalog-refresh failed: store=${result.storeName} stage=${result.stage} error=${result.error}`,
            );
        }
    }

    async refresh(): Promise<TCatalogRefreshResult> {
        const start = Date.now();
        const storeName = CATALOG_AQUAPHOR_STORE_NAME;

        const lockToken = await this.acquireLock();
        if (lockToken === null) {
            return {
                kind: 'skipped',
                reason: 'lock-held',
                storeName,
                elapsedMs: Date.now() - start,
            };
        }
        this.currentLockToken = lockToken;

        try {
            return await this.runOrchestrate(storeName, start);
        } finally {
            await this.releaseLock(lockToken);
            this.currentLockToken = null;
        }
    }

    private async runOrchestrate(
        storeName: string,
        start: number,
    ): Promise<TCatalogRefreshResult> {
        const findResult = await this.findStoreByName(storeName);
        if (!findResult.found) {
            return {
                kind: 'skipped',
                reason: 'store-not-found',
                storeName,
                elapsedMs: Date.now() - start,
                error: findResult.error,
            };
        }
        const { store } = findResult;
        const storeId = store.id;

        // Step 1 — extract configs (vectorStore + embedding).
        // Без них POST /upsert получит "Vector store not configured" (Flowise
        // подставляет конфиги в `if (docId)` ветке, для нового loader — нет).
        const configs = this.extractStoreConfigs(store);
        if (!configs) {
            return {
                kind: 'failure',
                storeId,
                storeName,
                elapsedMs: Date.now() - start,
                error: 'Store has no vectorStoreConfig or embeddingConfig — Phase 0 setup incomplete',
                stage: 'fetch-config',
            };
        }

        // Step 2 — wipe old loaders. Включает прежний broken S3 loader из PR6
        // и любые остатки от прошлых orchestrate refreshes.
        let loadersWiped: number;
        try {
            loadersWiped = await this.wipeLoaders(storeId, store.loaders);
        } catch (error) {
            return {
                kind: 'failure',
                storeId,
                storeName,
                elapsedMs: Date.now() - start,
                error: sanitizeError(error),
                stage: 'wipe-loaders',
            };
        }

        // Step 2.5 — TRUNCATE vectors table. Flowise DELETE loader не дропает
        // vectors из postgres (требует recordManager которого у нас нет —
        // см. comment в Flowise source: deleteVectorStoreFromStore line 339:
        // "Record Manager for Document Store is needed to delete data from
        // Vector Store"). Без TRUNCATE search возвращает stale chunks от
        // удалённых loader'ов. См. PR6.5 validation runs.
        const tableName = extractVectorStoreTableName(configs);
        if (!tableName) {
            return {
                kind: 'failure',
                storeId,
                storeName,
                elapsedMs: Date.now() - start,
                error: 'Cannot extract tableName from vectorStoreConfig.config.tableName — нужно для TRUNCATE',
                stage: 'wipe-vectors',
            };
        }
        try {
            await this.wipeVectorStoreTable(tableName);
        } catch (error) {
            return {
                kind: 'failure',
                storeId,
                storeName,
                elapsedMs: Date.now() - start,
                error: sanitizeError(error),
                stage: 'wipe-vectors',
            };
        }

        // Step 3 — download payload.
        let payloadRaw: string;
        try {
            payloadRaw = await this.downloadPayload();
        } catch (error) {
            // 404 на latest.json → soft-skip, остальные ошибки → failure
            const errorMsg = sanitizeError(error);
            if (errorMsg.toLowerCase().includes('not found')) {
                return {
                    kind: 'skipped',
                    reason: 'payload-not-found',
                    storeName,
                    elapsedMs: Date.now() - start,
                    error: errorMsg,
                };
            }
            return {
                kind: 'failure',
                storeId,
                storeName,
                elapsedMs: Date.now() - start,
                error: errorMsg,
                stage: 'download-payload',
            };
        }

        // Step 4 — parse + zod-validate.
        let payload: TBulkIngestPayload;
        try {
            payload = bulkIngestPayloadSchema.parse(JSON.parse(payloadRaw));
        } catch (error) {
            return {
                kind: 'failure',
                storeId,
                storeName,
                elapsedMs: Date.now() - start,
                error: sanitizeError(error),
                stage: 'parse-payload',
            };
        }

        // Step 5 — per-item upsert with concurrency limit.
        const outcomes = await this.upsertItems(storeId, configs, payload.items);
        const itemsUpserted = outcomes.filter((o) => o.ok).length;
        const itemsFailed = outcomes.length - itemsUpserted;

        // Логируем failed items с externalId — observability
        for (const outcome of outcomes) {
            if (!outcome.ok) {
                this.logger.warn(
                    `upsert failed: externalId=${outcome.externalId} error=${outcome.error}`,
                );
            }
        }

        return {
            kind: 'success',
            storeId,
            storeName,
            elapsedMs: Date.now() - start,
            itemsAttempted: payload.items.length,
            itemsUpserted,
            itemsFailed,
            loadersWiped,
        };
    }

    private async acquireLock(): Promise<string | null> {
        const token = randomUUID();
        const result = await this.redis.set(
            CATALOG_REFRESH_LOCK_KEY,
            token,
            'EX',
            CATALOG_REFRESH_LOCK_TTL_SEC,
            'NX',
        );
        return result === 'OK' ? token : null;
    }

    private async releaseLock(token: string): Promise<void> {
        await this.redis.eval(
            CATALOG_REFRESH_LOCK_RELEASE_LUA,
            1,
            CATALOG_REFRESH_LOCK_KEY,
            token,
        );
    }

    private async findStoreByName(name: string): Promise<TFindStoreResult> {
        try {
            const stores = await this.flowise.request<TFlowiseDocumentStore[]>(
                ENDPOINTS.documentStores,
            );
            const store = stores.find((s) => s.name === name);
            if (!store) {
                return {
                    found: false,
                    error: `Document Store "${name}" not found in Flowise`,
                };
            }
            return { found: true, store };
        } catch (error) {
            return { found: false, error: formatFlowiseError(error) };
        }
    }

    // Flowise отдаёт vectorStoreConfig/embeddingConfig либо как JSON-string
    // (raw API), либо как parsed object (через MCP-обёртки). Безопасно
    // нормализуем через type-guard.
    private extractStoreConfigs(store: TFlowiseDocumentStore): TStoreConfigs | null {
        const vectorRaw = parseJsonIfString(store.vectorStoreConfig);
        const embeddingRaw = parseJsonIfString(store.embeddingConfig);

        if (!isStoreConfigShape(vectorRaw) || !isStoreConfigShape(embeddingRaw)) {
            return null;
        }
        return { vectorStore: vectorRaw, embedding: embeddingRaw };
    }

    private async wipeLoaders(
        storeId: string,
        loaders: TFlowiseDocumentStore['loaders'],
    ): Promise<number> {
        // Sequential delete — параллельный DELETE может конфликтовать на
        // shared store entity update. Loaders обычно ≤10, sequential ok.
        for (const loader of loaders) {
            await this.flowise.request(ENDPOINTS.docstoreLoaderDelete(storeId, loader.id), {
                method: 'DELETE',
            });
        }
        return loaders.length;
    }

    private async wipeVectorStoreTable(tableName: string): Promise<void> {
        // Validate table name через whitelist regex — defensive против SQL
        // injection если когда-нибудь tableName начнёт приходить из user-input.
        // Сейчас это field из vectorStoreConfig (admin-controlled), но дешевле
        // закрыть сейчас чем разбираться позже.
        if (!isValidPostgresIdentifier(tableName)) {
            throw new Error(`Invalid Postgres table name (whitelist failed): ${tableName}`);
        }
        // pg-prisma раздельные query отдельно — `$executeRawUnsafe` идеально
        // подходит для DDL/TRUNCATE которые `$executeRaw` (parameterized) не
        // поддерживает. Identifier уже validated выше.
        await this.prisma.$executeRawUnsafe(`TRUNCATE TABLE "${tableName}"`);
    }

    private async downloadPayload(): Promise<string> {
        const stream = await this.storage.getObjectStream(CATALOG_PAYLOAD_KEY);
        const chunks: Buffer[] = [];
        for await (const chunk of stream.body) {
            chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
        }
        return Buffer.concat(chunks).toString('utf-8');
    }

    private async upsertItems(
        storeId: string,
        configs: TStoreConfigs,
        items: TBulkIngestItem[],
    ): Promise<TUpsertOutcome[]> {
        const outcomes: TUpsertOutcome[] = [];
        // Pool с фиксированной concurrency. Не используем p-limit (минимизируем
        // deps), inline implementation — items.length / CONCURRENCY iterations.
        for (let i = 0; i < items.length; i += CATALOG_UPSERT_CONCURRENCY) {
            const batch = items.slice(i, i + CATALOG_UPSERT_CONCURRENCY);
            const batchResults = await Promise.all(
                batch.map((item) => this.upsertItem(storeId, configs, item)),
            );
            outcomes.push(...batchResults);
        }
        return outcomes;
    }

    private async upsertItem(
        storeId: string,
        configs: TStoreConfigs,
        item: TBulkIngestItem,
    ): Promise<TUpsertOutcome> {
        try {
            await this.flowise.request(ENDPOINTS.documentStoreUpsert(storeId), {
                method: 'POST',
                body: {
                    loader: {
                        name: 'plainText',
                        config: {
                            text: item.contentForEmbedding,
                            metadata: JSON.stringify(buildItemMetadata(item)),
                        },
                    },
                    splitter: {
                        name: 'recursiveCharacterTextSplitter',
                        config: {
                            chunkSize: CATALOG_SPLITTER_CHUNK_SIZE,
                            chunkOverlap: CATALOG_SPLITTER_CHUNK_OVERLAP,
                        },
                    },
                    vectorStore: configs.vectorStore,
                    embedding: configs.embedding,
                    replaceExisting: false,
                },
            });
            return { ok: true, externalId: item.externalId };
        } catch (error) {
            return {
                ok: false,
                externalId: item.externalId,
                error: formatFlowiseError(error),
            };
        }
    }
}

// =============================================================================
// Helpers (pure, тестируются отдельно от service-state)
// =============================================================================

// Метаданные которые feeder отдаёт через PlainText loader. Whitelist'им только
// поля которые нужны для search response enrichment + cross-reference с feeder
// системой. Остальные поля (contentForEmbedding, contentHash, attributes) живут
// в pageContent / контракте, в metadata их класть не надо — search response
// фильтрует через METADATA_WHITELIST в TextSearchService.
//
// Sync-trigger см. tech-debt #23 «METADATA_WHITELIST sync trigger».
function buildItemMetadata(item: TBulkIngestItem): Record<string, unknown> {
    return {
        externalId: item.externalId,
        externalSource: item.externalSource,
        externalType: item.externalType,
        name: item.name,
        description: item.description ?? null,
        salePriceKopecks: item.salePriceKopecks ?? null,
        categoryPath: item.categoryPath ?? null,
        rangForApp: item.rangForApp ?? null,
        imageUrls: item.imageUrls,
    };
}

function parseJsonIfString(value: unknown): unknown {
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch {
            return null;
        }
    }
    return value;
}

function isStoreConfigShape(
    value: unknown,
): value is { name: string; config: Record<string, unknown> } {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const v = value as Record<string, unknown>;
    return (
        typeof v.name === 'string' &&
        v.name.length > 0 &&
        typeof v.config === 'object' &&
        v.config !== null
    );
}

// Достаёт `tableName` из vectorStoreConfig.config — нужен для TRUNCATE
// vector table перед re-upsert. Возвращает null если поле отсутствует или
// не строка (мы поддерживаем только Postgres vector store; для Pinecone /
// Chroma / Weaviate понадобится ветка через vectorStoreConfig.name).
function extractVectorStoreTableName(configs: TStoreConfigs): string | null {
    const vsName = configs.vectorStore.name;
    if (vsName !== 'postgres') {
        return null;
    }
    const tableName = configs.vectorStore.config.tableName;
    return typeof tableName === 'string' && tableName.length > 0 ? tableName : null;
}

// Postgres identifier whitelist — `[A-Za-z_][A-Za-z0-9_]*` (стандарт SQL без
// quoting). Не пускаем `--`, `;`, кавычки, пробелы. Длина ≤63 (Postgres limit).
function isValidPostgresIdentifier(name: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(name);
}
