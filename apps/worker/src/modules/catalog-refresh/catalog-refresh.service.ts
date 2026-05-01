import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import Redis from 'ioredis';
import { z } from 'zod';
import { sanitizeError } from '@slovo/common';
import {
    ENDPOINTS,
    FlowiseClient,
    formatFlowiseError,
    type TFlowiseDocumentStore,
} from '@slovo/flowise-client';
import { StorageService } from '@slovo/storage';
import {
    ALLOWED_VECTOR_TABLES,
    CATALOG_AQUAPHOR_STORE_NAME,
    CATALOG_LOADERS_REDIS_KEY,
    CATALOG_MAX_PAYLOAD_BYTES,
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
// CatalogRefreshService — slovo-orchestrate ingest pipeline (PR9.5
// RecordManager-based idempotency).
//
// Эволюция:
// - PR6: `flowise_docstore_refresh` через broken S3 File Loader → отказ
// - PR6.5: slovo-orchestrate с TRUNCATE + per-item upsert (сложно: full
//   re-embed на каждый cron tick, ~$0.03/день)
// - PR9.5: + Flowise RecordManager + slovo Redis loader-mapping →
//   skip-if-unchanged через LangChain Indexing API. ~90× cost reduction.
//
// Pipeline:
// 1. Acquire Redis lock (uuid + Lua-CAS — без изменений)
// 2. Resolve storeId by name
// 3. Extract vectorStoreConfig + embeddingConfig + recordManagerConfig из store
// 4. Load slovo:catalog:loaders mapping (externalId → docId) из Redis
// 5. Download latest.json через StorageService
// 6. Parse + zod-validate
// 7. Per-item upsert (sequential):
//    - Если есть stored docId → upsert WITH it → RecordManager skip if hash same
//    - Если нет → upsert WITHOUT docId → Flowise creates new, store returned docId
// 8. REMOVED-sweep: items в mapping но не в payload → DELETE loader + HDEL
// 9. Release lock (Lua-CAS)
// =============================================================================

type TStoreConfigs = {
    vectorStore: { name: string; config: Record<string, unknown> };
    embedding: { name: string; config: Record<string, unknown> };
    recordManager: { name: string; config: Record<string, unknown> } | null;
};

type TUpsertOutcome =
    | { kind: 'upserted'; externalId: string; docId: string }
    | { kind: 'skipped'; externalId: string; docId: string }
    | { kind: 'failed'; externalId: string; error: string };

// =============================================================================
// Zod-schema для Flowise /document-store/upsert response.
//
// Defence-in-depth: response уходит в Redis HSET (`docId` как value HASH'а).
// Сейчас exploit ограничен self-DoS (искажение собственного mapping), но при
// будущем переходе на per-store key типа `slovo:catalog:loaders:${docId}`
// невалидированный `docId` станет key-injection vector.
//
// docId Flowise генерирует через uuid v4 — regex закрывает оба формата
// (с/без дефисов) и ограничивает длину 64 chars, чтобы не пустить мусор в
// Redis. Числовые counters — nonnegative int, иначе либо сломан Flowise,
// либо подделка.
// =============================================================================
const flowiseUpsertResponseSchema = z.object({
    numAdded: z.number().int().nonnegative().optional(),
    numUpdated: z.number().int().nonnegative().optional(),
    numSkipped: z.number().int().nonnegative().optional(),
    numDeleted: z.number().int().nonnegative().optional(),
    docId: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-zA-Z0-9_-]+$/)
        .optional(),
});

type TFlowiseUpsertResponse = z.infer<typeof flowiseUpsertResponseSchema>;

@Injectable()
export class CatalogRefreshService implements OnModuleDestroy {
    private readonly logger = new Logger(CatalogRefreshService.name);
    private currentLockToken: string | null = null;

    constructor(
        @Inject(FLOWISE_CLIENT_TOKEN) private readonly flowise: FlowiseClient,
        @Inject(REDIS_CLIENT_TOKEN) private readonly redis: Redis,
        private readonly storage: StorageService,
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
                    `total=${result.itemsTotal} upserted=${result.itemsUpserted} ` +
                    `skipped=${result.itemsSkipped} removed=${result.itemsRemoved} ` +
                    `failed=${result.itemsFailed} elapsed=${result.elapsedMs}ms`,
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
        // Step 1 — find store + extract configs (vectorStore + embedding +
        // recordManager). RecordManager **обязателен** для PR9.5 idempotency
        // — если его нет, refresh fails fast (rather чем silent re-embed all).
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

        const configs = this.extractStoreConfigs(store);
        if (!configs) {
            return {
                kind: 'failure',
                storeId,
                storeName,
                elapsedMs: Date.now() - start,
                error:
                    'Store has no vectorStoreConfig / embeddingConfig / recordManagerConfig — ' +
                    'требуется для PR9.5 idempotent ingest. Setup через flowise_docstore_vectorstore_save.',
                stage: 'fetch-config',
            };
        }
        // Validation table name — defensive против admin mistake (raw SQL
        // блок'нут на Flowise side, но slovo тоже ловит): TRUNCATE сейчас не
        // делается (RecordManager handles), но whitelist оставлен на будущее
        // если понадобится emergency wipe.
        const tableName = configs.vectorStore.config.tableName;
        if (typeof tableName === 'string' && !ALLOWED_VECTOR_TABLES.has(tableName)) {
            return {
                kind: 'failure',
                storeId,
                storeName,
                elapsedMs: Date.now() - start,
                error: `vectorStore.tableName "${tableName}" not in ALLOWED_VECTOR_TABLES whitelist`,
                stage: 'fetch-config',
            };
        }

        // Step 2 — load existing externalId → docId mapping из Redis.
        let loaderMapping: Record<string, string>;
        try {
            loaderMapping = await this.loadLoaderMapping();
        } catch (error) {
            return {
                kind: 'failure',
                storeId,
                storeName,
                elapsedMs: Date.now() - start,
                error: sanitizeError(error),
                stage: 'load-loader-mapping',
            };
        }

        // Step 3 — download payload.
        let payloadRaw: string;
        try {
            payloadRaw = await this.downloadPayload();
        } catch (error) {
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

        // Step 5 — per-item upsert. RecordManager делает skip-if-unchanged
        // когда we передаём stored docId (metadata.docId stable → hash stable).
        const outcomes = await this.upsertItems(storeId, configs, payload.items, loaderMapping);

        // Step 6 — REMOVED-sweep. Items в mapping но не в payload — товар
        // удалён в feeder. Удаляем loader из Flowise + HDEL Redis mapping.
        const currentExternalIds = new Set(payload.items.map((i) => i.externalId));
        const removedExternalIds = Object.keys(loaderMapping).filter(
            (eid) => !currentExternalIds.has(eid),
        );
        let itemsRemoved = 0;
        try {
            itemsRemoved = await this.removeStaleLoaders(storeId, loaderMapping, removedExternalIds);
        } catch (error) {
            // REMOVED-sweep failure не fatal — main upsert уже succeeded.
            // Логируем, считаем как partial success.
            this.logger.warn(
                `REMOVED-sweep partial failure: ${sanitizeError(error)}. Items может остаться stale до next refresh.`,
            );
        }

        // Persist updated mapping в Redis: новые docId после первого upsert
        // + удалить removed items.
        try {
            await this.persistLoaderMapping(loaderMapping, outcomes, removedExternalIds);
        } catch (error) {
            this.logger.warn(
                `persist loader mapping failed: ${sanitizeError(error)}. Next refresh re-issues docIds — extra cost но не корректность.`,
            );
        }

        const itemsUpserted = outcomes.filter((o) => o.kind === 'upserted').length;
        const itemsSkipped = outcomes.filter((o) => o.kind === 'skipped').length;
        const itemsFailed = outcomes.length - itemsUpserted - itemsSkipped;

        for (const outcome of outcomes) {
            if (outcome.kind === 'failed') {
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
            itemsTotal: payload.items.length,
            itemsUpserted,
            itemsSkipped,
            itemsFailed,
            itemsRemoved,
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

    private extractStoreConfigs(store: TFlowiseDocumentStore): TStoreConfigs | null {
        const vectorRaw = parseJsonIfString(store.vectorStoreConfig);
        const embeddingRaw = parseJsonIfString(store.embeddingConfig);
        const recordManagerRaw = parseJsonIfString(store.recordManagerConfig);

        if (!isStoreConfigShape(vectorRaw) || !isStoreConfigShape(embeddingRaw)) {
            return null;
        }
        // RecordManager обязателен — без него идём back в re-embed-all flow,
        // что плохо. Fail fast.
        if (!isStoreConfigShape(recordManagerRaw)) {
            return null;
        }
        return {
            vectorStore: vectorRaw,
            embedding: embeddingRaw,
            recordManager: recordManagerRaw,
        };
    }

    private async loadLoaderMapping(): Promise<Record<string, string>> {
        return this.redis.hgetall(CATALOG_LOADERS_REDIS_KEY);
    }

    private async persistLoaderMapping(
        existingMapping: Record<string, string>,
        outcomes: TUpsertOutcome[],
        removedExternalIds: string[],
    ): Promise<void> {
        // Updates: новые docId для items без stored mapping. Двойная защита:
        // (1) `outcome.docId` строго проверен в `upsertItem` (zod schema +
        //     refuse если undefined) — пустой не попадёт сюда.
        // (2) Здесь дополнительная проверка `!== ''` — если кто-то в будущем
        //     ослабит `upsertItem`, мусор не пройдёт в Redis.
        const updates: Record<string, string> = {};
        for (const outcome of outcomes) {
            if (
                outcome.kind !== 'failed' &&
                outcome.docId !== '' &&
                !existingMapping[outcome.externalId]
            ) {
                updates[outcome.externalId] = outcome.docId;
            }
        }
        if (Object.keys(updates).length > 0) {
            await this.redis.hset(CATALOG_LOADERS_REDIS_KEY, updates);
        }
        if (removedExternalIds.length > 0) {
            await this.redis.hdel(CATALOG_LOADERS_REDIS_KEY, ...removedExternalIds);
        }
    }

    private async removeStaleLoaders(
        storeId: string,
        mapping: Record<string, string>,
        removedExternalIds: string[],
    ): Promise<number> {
        let count = 0;
        for (const externalId of removedExternalIds) {
            const docId = mapping[externalId];
            if (!docId) continue;
            try {
                await this.flowise.request(ENDPOINTS.docstoreLoaderDelete(storeId, docId), {
                    method: 'DELETE',
                });
                count++;
            } catch (error) {
                this.logger.warn(
                    `removeStaleLoader failed: externalId=${externalId} docId=${docId} error=${sanitizeError(error)}`,
                );
            }
        }
        return count;
    }

    private async downloadPayload(): Promise<string> {
        const stream = await this.storage.getObjectStream(CATALOG_PAYLOAD_KEY);
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        for await (const chunk of stream.body) {
            // Node.js Readable iteration даёт `string | Buffer | Uint8Array`
            // в зависимости от encoding. Явный type-guard для strict mode.
            let buf: Buffer;
            if (typeof chunk === 'string') {
                buf = Buffer.from(chunk, 'utf-8');
            } else if (Buffer.isBuffer(chunk)) {
                buf = chunk;
            } else if (chunk instanceof Uint8Array) {
                buf = Buffer.from(chunk);
            } else {
                throw new Error(
                    `Unexpected stream chunk type: ${typeof chunk}`,
                );
            }
            totalBytes += buf.length;
            if (totalBytes > CATALOG_MAX_PAYLOAD_BYTES) {
                throw new Error(
                    `Payload size ${totalBytes} bytes exceeds CATALOG_MAX_PAYLOAD_BYTES=${CATALOG_MAX_PAYLOAD_BYTES} — possible malicious feeder`,
                );
            }
            chunks.push(buf);
        }
        return Buffer.concat(chunks).toString('utf-8');
    }

    private async upsertItems(
        storeId: string,
        configs: TStoreConfigs,
        items: TBulkIngestItem[],
        loaderMapping: Record<string, string>,
    ): Promise<TUpsertOutcome[]> {
        // CONCURRENCY=1 — Flowise saveProcessingLoader read-modify-write race
        // (см. constants.ts:73). Promise.all на batch сохранён для будущего
        // case'а если Flowise залатают upstream race; сейчас ровно эквивалентен
        // sequential for/await, но не требует переписывания при увеличении.
        const outcomes: TUpsertOutcome[] = [];
        for (let i = 0; i < items.length; i += CATALOG_UPSERT_CONCURRENCY) {
            const batch = items.slice(i, i + CATALOG_UPSERT_CONCURRENCY);
            const batchResults = await Promise.all(
                batch.map((item) =>
                    this.upsertItem(storeId, configs, item, loaderMapping[item.externalId]),
                ),
            );
            outcomes.push(...batchResults);
        }
        return outcomes;
    }

    private async upsertItem(
        storeId: string,
        configs: TStoreConfigs,
        item: TBulkIngestItem,
        existingDocId: string | undefined,
    ): Promise<TUpsertOutcome> {
        try {
            const body: Record<string, unknown> = {
                loader: {
                    name: 'plainText',
                    config: {
                        text: item.contentForEmbedding,
                        // PlainText loader ожидает metadata как **JSON-string**,
                        // не как object. Flowise делает `JSON.parse(config.metadata)`.
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
                recordManager: configs.recordManager,
                // replaceExisting обязателен когда docId передан — иначе
                // Flowise отказывается update'ить existing loader.
                replaceExisting: existingDocId !== undefined,
            };
            if (existingDocId !== undefined) {
                body.docId = existingDocId;
            }

            const rawResponse = await this.flowise.request<unknown>(
                ENDPOINTS.documentStoreUpsert(storeId),
                { method: 'POST', body },
            );
            const response: TFlowiseUpsertResponse =
                flowiseUpsertResponseSchema.parse(rawResponse);

            const docId = response.docId ?? existingDocId;
            // Edge case: Flowise не вернул docId И в mapping не было stored.
            // Без docId outcome нельзя считать `upserted` — иначе попадёт в
            // HSET с пустым value, на следующем refresh defensive `if (!docId)
            // continue` в removeStaleLoaders спасёт от crash, но мы потеряем
            // RecordManager skip для этого item навсегда. Лучше явный fail
            // → next cron retry.
            if (docId === undefined) {
                return {
                    kind: 'failed',
                    externalId: item.externalId,
                    error: 'Flowise upsert response без docId и нет stored docId — невозможно зафиксировать в mapping',
                };
            }
            const wasSkipped =
                (response.numSkipped ?? 0) > 0 &&
                (response.numAdded ?? 0) === 0 &&
                (response.numUpdated ?? 0) === 0;

            return {
                kind: wasSkipped ? 'skipped' : 'upserted',
                externalId: item.externalId,
                docId,
            };
        } catch (error) {
            return {
                kind: 'failed',
                externalId: item.externalId,
                error: formatFlowiseError(error),
            };
        }
    }
}

// =============================================================================
// Helpers (pure)
// =============================================================================

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
