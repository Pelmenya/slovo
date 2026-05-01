import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';
import {
    ENDPOINTS,
    type FlowiseClient,
    formatFlowiseError,
    type TFlowiseQueryResponse,
} from '@slovo/flowise-client';
import type { StorageService } from '@slovo/storage';
import {
    CATALOG_AQUAPHOR_STORE_ID,
    CATALOG_DEFAULT_TOP_K,
    CATALOG_PRESIGNED_CACHE_KEY_PREFIX,
    CATALOG_PRESIGNED_CACHE_TTL_SEC,
    CATALOG_PRESIGNED_URL_TTL_SEC,
    CATALOG_STORAGE_SERVICE_TOKEN,
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
        @Inject(CATALOG_STORAGE_SERVICE_TOKEN) private readonly storage: StorageService,
    ) {}

    async onModuleDestroy(): Promise<void> {
        // Graceful Redis disconnect при SIGTERM. quit() ждёт pending команды,
        // в отличие от disconnect() который форсит. Wrap в try/catch чтобы
        // упавшее соединение не ломало shutdown остальных модулей.
        try {
            await this.redis.quit();
        } catch (error) {
            this.logger.warn(`redis.quit() failed (degraded shutdown): ${formatFlowiseError(error)}`);
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
// `imageUrls` как `string[]` (см. ADR-007 + vision-catalog-search.md). До
// перехода feeder'а на pure JSON loader Flowise может сериализовать массив
// как строку — отдельная логика fallback'а здесь не нужна, в Phase 0 lab
// journal зафиксировано что приходит чистый array.
//
// Любая иная форма (string, undefined, объект) → пустой массив. Не throw'аем,
// чтобы один битый чанк не валил весь search.
// =============================================================================

function extractImageKeys(metadata: Record<string, unknown>): string[] {
    const raw = metadata.imageUrls;
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw.filter((v): v is string => typeof v === 'string' && v.length > 0);
}
