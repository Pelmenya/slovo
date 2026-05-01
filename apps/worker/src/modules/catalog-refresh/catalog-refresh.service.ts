import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import Redis from 'ioredis';
import { FlowiseClient, ENDPOINTS, formatFlowiseError } from '@slovo/flowise-client';
import type { TFlowiseDocumentStore } from '@slovo/flowise-client';
import {
    CATALOG_AQUAPHOR_STORE_NAME,
    CATALOG_REFRESH_CRON,
    CATALOG_REFRESH_LOCK_KEY,
    CATALOG_REFRESH_LOCK_TTL_SEC,
} from './catalog-refresh.constants';
import type { TCatalogRefreshResult, TFindStoreResult } from './t-catalog-refresh';

export const FLOWISE_CLIENT_TOKEN = 'FLOWISE_CLIENT';
export const REDIS_CLIENT_TOKEN = 'REDIS_CLIENT';

// =============================================================================
// CatalogRefreshService — cron каждые 4ч триггерит flowise_docstore_refresh
// для catalog-aquaphor. Защищён distributed lock через Redis (SET NX EX) —
// если предыдущий refresh ещё работает (refresh синхронный, может занимать
// минуты на 1000+ items), новый запуск пропускается.
//
// Логика проста (PR6 Phase 1):
// 1. Acquire Redis lock — если занят, skip ('lock-held').
// 2. Find store by name — если не нашли, skip ('store-not-found') + warn.
// 3. POST /document-store/refresh/<id> с replaceExisting=true (без него
//    старые chunks остаются — см. dist/services/documentstore/index.js:1364).
// 4. Release lock в finally.
//
// Не использует mcp-flowise (он для Claude Code). Дёргает Flowise REST
// напрямую через @slovo/flowise-client (чистый REST-клиент с retry).
// =============================================================================

@Injectable()
export class CatalogRefreshService implements OnModuleDestroy {
    private readonly logger = new Logger(CatalogRefreshService.name);

    constructor(
        @Inject(FLOWISE_CLIENT_TOKEN) private readonly flowise: FlowiseClient,
        @Inject(REDIS_CLIENT_TOKEN) private readonly redis: Redis,
    ) {}

    async onModuleDestroy(): Promise<void> {
        await this.redis.quit();
    }

    @Cron(CATALOG_REFRESH_CRON, { name: 'catalog-refresh' })
    async runScheduled(): Promise<void> {
        const result = await this.refresh();
        if (result.success) {
            this.logger.log(
                `catalog-refresh completed: store=${result.storeName} elapsed=${result.elapsedMs}ms`,
            );
        } else if (result.skipped) {
            this.logger.warn(`catalog-refresh skipped: reason=${result.skipped}`);
        } else {
            this.logger.error(
                `catalog-refresh failed: store=${result.storeName} error=${result.error}`,
            );
        }
    }

    async refresh(): Promise<TCatalogRefreshResult> {
        const start = Date.now();
        const storeName = CATALOG_AQUAPHOR_STORE_NAME;

        const lockAcquired = await this.acquireLock();
        if (!lockAcquired) {
            return {
                storeId: '',
                storeName,
                success: false,
                elapsedMs: Date.now() - start,
                skipped: 'lock-held',
            };
        }

        try {
            const findResult = await this.findStoreByName(storeName);
            if (!findResult.found) {
                return {
                    storeId: '',
                    storeName,
                    success: false,
                    elapsedMs: Date.now() - start,
                    skipped: 'store-not-found',
                    error: findResult.error,
                };
            }

            const storeId = findResult.store.id;
            try {
                const flowiseResponse = await this.flowise.request<Record<string, unknown>>(
                    ENDPOINTS.documentStoreRefresh(storeId),
                    {
                        method: 'POST',
                        body: { replaceExisting: true },
                    },
                );
                return {
                    storeId,
                    storeName,
                    success: true,
                    elapsedMs: Date.now() - start,
                    flowiseResponse,
                };
            } catch (error) {
                return {
                    storeId,
                    storeName,
                    success: false,
                    elapsedMs: Date.now() - start,
                    error: formatFlowiseError(error),
                };
            }
        } finally {
            await this.releaseLock();
        }
    }

    private async acquireLock(): Promise<boolean> {
        const result = await this.redis.set(
            CATALOG_REFRESH_LOCK_KEY,
            '1',
            'EX',
            CATALOG_REFRESH_LOCK_TTL_SEC,
            'NX',
        );
        return result === 'OK';
    }

    private async releaseLock(): Promise<void> {
        await this.redis.del(CATALOG_REFRESH_LOCK_KEY);
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
}
