import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';
import { sanitizeError } from '@slovo/common';
import {
    ENDPOINTS,
    type FlowiseClient,
    type TFlowiseDocumentStore,
    type TFlowiseQueryResponse,
} from '@slovo/flowise-client';
import { StorageService } from '@slovo/storage';
import {
    CATALOG_AQUAPHOR_STORE_NAME,
    CATALOG_DEFAULT_TOP_K,
    CATALOG_PRESIGNED_CACHE_KEY_PREFIX,
    CATALOG_PRESIGNED_CACHE_TTL_SEC,
    CATALOG_PRESIGNED_URL_TTL_SEC,
    FLOWISE_CLIENT_TOKEN,
    REDIS_CLIENT_TOKEN,
} from '../catalog.constants';
import {
    SearchTextDocResponseDto,
    SearchTextResponseDto,
} from './dto/search-text.response.dto';

// =============================================================================
// TextSearchService — vector search по каталогу через Flowise Document Store
// + enrichment presigned S3 URL'ами.
//
// Pipeline:
// 1. Resolve storeId по имени (lazy + single-flight + retry on failure).
// 2. POST /document-store/vectorstore/query → top-K docs с metadata.
// 3. Для каждого doc — извлекаем imageUrls из metadata (S3-keys, validated).
// 4. Resolve presigned URL: cache-first через Redis (TTL 50м), miss → S3
//    presign (TTL 1ч) → cache write. Single-flight на cold cache (in-memory
//    Map) — concurrent requests на тот же key делают один S3 sign.
// 5. Whitelist metadata (pickMetadata) перед отдачей клиенту — не пропускаем
//    случайные feeder-поля (cost / margin / supplier-internal-id).
// 6. Возвращаем shape с count, docs, timeTakenMs.
//
// Cost для search-hot-path:
// - Flowise vectorstoreQuery: ~300ms (1 OpenAI embed + pgvector cosine).
// - Presigned URLs: cache hit = $0/0ms, miss = SigV4 signing локально, ~5ms.
// - StoreId lookup: один раз на boot service-a + retry on failure.
// =============================================================================

// Whitelist metadata-полей которые отдаём клиенту. Любое feeder-поле вне
// списка отбрасывается — защита от случайной утечки cost/margin/supplier-id
// при расширении feeder'а в будущем. См. security audit follow-up: «whole-
// metadata pass-through без whitelist».
//
// Что включено и почему:
// - externalId / externalType / externalSource — stable cross-reference ID
//   с feeder-системой (CRM использует для cross-link).
// - categoryPath — UI группировка / filter.
// - name / description / salePriceKopecks — отображение в карточке.
// - rangForApp — UI badge «приоритет» (managers-curated ranking signal).
//
// imageUrls — НЕ в whitelist: возвращаем presigned URLs отдельным полем,
// raw S3-keys клиенту знать не нужно (только наш bucket → отдельно accessible).
const METADATA_WHITELIST: ReadonlyArray<string> = [
    'externalId',
    'externalType',
    'externalSource',
    'categoryPath',
    'name',
    'description',
    'salePriceKopecks',
    'rangForApp',
];

@Injectable()
export class TextSearchService implements OnModuleDestroy {
    private readonly logger = new Logger(TextSearchService.name);

    // Lazy-resolved storeId: первый search триггерит lookup, остальные ждут
    // ту же Promise (single-flight). При ошибке — promise обнуляется,
    // следующий request получит retry.
    private storeIdPromise: Promise<string> | null = null;

    // Inflight Map для presigned URL resolution — защита от cache stampede:
    // 50 concurrent search'ей на тот же cold key → один S3 sign call,
    // остальные await тот же Promise. Запись удаляется после resolution
    // (success или error) — Redis cache живёт независимо.
    private readonly inflightUrls = new Map<string, Promise<string>>();

    constructor(
        @Inject(FLOWISE_CLIENT_TOKEN) private readonly flowise: FlowiseClient,
        @Inject(REDIS_CLIENT_TOKEN) private readonly redis: Redis,
        // StorageService injected стандартно — DynamicModule scope из
        // `StorageModule.forFeature({ bucketEnvKey: 'S3_CATALOG_BUCKET' })`
        // в catalog.module.ts даёт нам instance bound к slovo-datasets,
        // не к knowledge bucket S3_BUCKET=slovo-sources.
        private readonly storage: StorageService,
    ) {}

    async onModuleDestroy(): Promise<void> {
        // Graceful Redis disconnect при SIGTERM. quit() ждёт pending команды,
        // в отличие от disconnect() который форсит. Wrap в try/catch чтобы
        // упавшее соединение не ломало shutdown остальных модулей.
        try {
            await this.redis.quit();
        } catch (error) {
            this.logger.warn(`redis.quit() failed (degraded shutdown): ${sanitizeError(error)}`);
        }
    }

    async search(query: string, topK?: number): Promise<SearchTextResponseDto> {
        const effectiveTopK = topK ?? CATALOG_DEFAULT_TOP_K;
        const storeId = await this.resolveStoreId();

        const flowiseResponse = await this.flowise.request<TFlowiseQueryResponse>(
            ENDPOINTS.vectorstoreQuery,
            {
                method: 'POST',
                body: { storeId, query, topK: effectiveTopK },
            },
        );

        // Level-1 dedup: уникальные S3-keys через все docs в одном response.
        // 5 чанков ссылающихся на одну картинку → один resolveOne call.
        const uniqueKeys = new Set<string>();
        for (const doc of flowiseResponse.docs) {
            for (const key of extractImageKeys(doc.metadata)) {
                uniqueKeys.add(key);
            }
        }

        // Resolve все unique keys параллельно (level-2 single-flight внутри).
        const keysArray = Array.from(uniqueKeys);
        const urls = await Promise.all(keysArray.map((key) => this.resolvePresignedUrl(key)));
        const urlMap = new Map(keysArray.map((key, idx) => [key, urls[idx]] as const));

        const docs = flowiseResponse.docs.map((doc): SearchTextDocResponseDto => {
            const keys = extractImageKeys(doc.metadata);
            return {
                id: doc.id,
                pageContent: doc.pageContent,
                metadata: pickMetadata(doc.metadata),
                imageUrls: keys
                    .map((k) => urlMap.get(k))
                    .filter((u): u is string => typeof u === 'string'),
            };
        });

        return {
            count: docs.length,
            docs,
            timeTakenMs: flowiseResponse.timeTaken,
        };
    }

    private resolveStoreId(): Promise<string> {
        if (!this.storeIdPromise) {
            this.storeIdPromise = this.lookupStoreId().catch((err: unknown) => {
                // Reset чтобы следующий request попробовал заново. Без
                // этого временный network-blip намертво сломал бы service.
                this.storeIdPromise = null;
                throw err;
            });
        }
        return this.storeIdPromise;
    }

    private async lookupStoreId(): Promise<string> {
        const stores = await this.flowise.request<TFlowiseDocumentStore[]>(
            ENDPOINTS.documentStores,
        );
        const store = stores.find((s) => s.name === CATALOG_AQUAPHOR_STORE_NAME);
        if (!store) {
            throw new Error(
                `Document Store "${CATALOG_AQUAPHOR_STORE_NAME}" not found in Flowise — ` +
                    `проверь что store создан и слой ingest-feeder работает`,
            );
        }
        this.logger.log(`catalog store "${CATALOG_AQUAPHOR_STORE_NAME}" → id=${store.id}`);
        return store.id;
    }

    private resolvePresignedUrl(key: string): Promise<string> {
        // Single-flight: если уже есть pending Promise для этого key —
        // возвращаем его, не делаем дубликат S3 sign call.
        const existing = this.inflightUrls.get(key);
        if (existing) {
            return existing;
        }
        const promise = this.doResolvePresignedUrl(key).finally(() => {
            this.inflightUrls.delete(key);
        });
        this.inflightUrls.set(key, promise);
        return promise;
    }

    private async doResolvePresignedUrl(key: string): Promise<string> {
        const cacheKey = `${CATALOG_PRESIGNED_CACHE_KEY_PREFIX}${key}`;
        const cached = await this.redis.get(cacheKey);
        if (cached) {
            return cached;
        }
        const url = await this.storage.getPresignedDownloadUrl(key, {
            expiresInSeconds: CATALOG_PRESIGNED_URL_TTL_SEC,
        });
        await this.redis.set(cacheKey, url, 'EX', CATALOG_PRESIGNED_CACHE_TTL_SEC);
        return url;
    }
}

// =============================================================================
// pickMetadata — whitelist-фильтр feeder-метаданных перед отдачей клиенту.
//
// Защита от accidental info-leak: feeder может расширить metadata cost'ом /
// margin'ом / B2B-ценой / supplier-internal-id. Без whitelist все эти поля
// сразу станут публичными в search response. Whitelist'им только bounded
// набор полей перечисленных в METADATA_WHITELIST.
// =============================================================================

function pickMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const key of METADATA_WHITELIST) {
        if (key in metadata) {
            result[key] = metadata[key];
        }
    }
    return result;
}

// =============================================================================
// Извлечь S3-keys картинок из metadata чанка. Feeder (CRM) кладёт их в поле
// `imageUrls` как `string[]` (см. ADR-007 + vision-catalog-search.md).
//
// Любая иная форма (string, undefined, объект) → пустой массив. Не throw'аем,
// чтобы один битый чанк не валил весь search.
//
// Защита от path-injection: feeder теоретически может класть `../../../...`
// или абсолютные URL'ы — `getPresignedDownloadUrl` подпишет любую строку
// без проверки. Whitelist validation на стороне slovo: разрешены только
// относительные S3-keys из ASCII-набора `[a-zA-Z0-9/_.-]`, без leading `/`
// и без `..` segments. Защита defensive — наш bucket, мы только читаем —
// но проще закрыть здесь чем разбираться в incident'ах позже.
// =============================================================================

const S3_KEY_ALLOWED_CHARS = /^[a-zA-Z0-9/_.-]+$/;

function isValidS3Key(key: string): boolean {
    if (key.length === 0 || key.length > 1024) {
        return false;
    }
    if (key.startsWith('/') || key.startsWith('.')) {
        return false;
    }
    // Path traversal: '..' как отдельный сегмент. `'a..b'` — допустимо
    // (часть имени файла), `'../etc'` — нет.
    if (key.split('/').some((segment) => segment === '..')) {
        return false;
    }
    return S3_KEY_ALLOWED_CHARS.test(key);
}

function extractImageKeys(metadata: Record<string, unknown>): string[] {
    const raw = metadata.imageUrls;
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw.filter(
        (v): v is string => typeof v === 'string' && isValidS3Key(v),
    );
}
