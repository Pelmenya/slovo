import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';
import { sanitizeError } from '@slovo/common';
import {
    ENDPOINTS,
    type FlowiseClient,
    type TFlowiseQueryResponse,
} from '@slovo/flowise-client';
import { StorageService } from '@slovo/storage';
import {
    CATALOG_AQUAPHOR_STORE_ID,
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
// 1. POST /document-store/vectorstore/query → top-K docs с metadata.
// 2. Для каждого doc — извлекаем imageUrls из metadata (S3-keys).
// 3. Resolve presigned URL: cache-first через Redis (TTL 50м), miss → S3
//    presign (TTL 1ч) → cache write.
// 4. Возвращаем shape с count, docs, timeTaken.
//
// Cost для search-hot-path:
// - Flowise vectorstoreQuery: ~300ms (1 OpenAI embed + pgvector cosine).
// - Presigned URLs: cache hit = $0/0ms, miss = SigV4 signing локально, ~5ms.
// =============================================================================

@Injectable()
export class TextSearchService implements OnModuleDestroy {
    private readonly logger = new Logger(TextSearchService.name);

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
        const flowiseResponse = await this.flowise.request<TFlowiseQueryResponse>(
            ENDPOINTS.vectorstoreQuery,
            {
                method: 'POST',
                body: {
                    storeId: CATALOG_AQUAPHOR_STORE_ID,
                    query,
                    topK: effectiveTopK,
                },
            },
        );

        const docs = await Promise.all(
            flowiseResponse.docs.map((doc) => this.enrichDoc(doc)),
        );

        return {
            count: docs.length,
            docs,
            timeTakenMs: flowiseResponse.timeTaken,
        };
    }

    private async enrichDoc(
        doc: TFlowiseQueryResponse['docs'][number],
    ): Promise<SearchTextDocResponseDto> {
        const imageKeys = extractImageKeys(doc.metadata);
        const imageUrls = await this.resolvePresignedUrls(imageKeys);
        return {
            id: doc.id,
            pageContent: doc.pageContent,
            metadata: doc.metadata,
            imageUrls,
        };
    }

    private async resolvePresignedUrls(keys: string[]): Promise<string[]> {
        if (keys.length === 0) {
            return [];
        }
        return Promise.all(keys.map((key) => this.resolveOnePresignedUrl(key)));
    }

    private async resolveOnePresignedUrl(key: string): Promise<string> {
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
