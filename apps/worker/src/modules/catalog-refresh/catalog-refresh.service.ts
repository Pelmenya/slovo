import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import Redis from 'ioredis';
import {
    ENDPOINTS,
    FlowiseClient,
    formatFlowiseError,
    type TFlowiseDocumentStore,
    type TFlowiseRefreshResponse,
} from '@slovo/flowise-client';
import {
    CATALOG_AQUAPHOR_STORE_NAME,
    CATALOG_REFRESH_CRON,
    CATALOG_REFRESH_LOCK_KEY,
    CATALOG_REFRESH_LOCK_RELEASE_LUA,
    CATALOG_REFRESH_LOCK_TTL_SEC,
    FLOWISE_CLIENT_TOKEN,
    REDIS_CLIENT_TOKEN,
} from './catalog-refresh.constants';
import type {
    TCatalogRefreshResult,
    TFindStoreResult,
} from './t-catalog-refresh';

// =============================================================================
// CatalogRefreshService — cron каждые 4ч триггерит flowise_docstore_refresh
// для catalog-aquaphor. Защищён distributed lock через Redis с fence-token
// (uuid per acquire) — release через Lua-CAS чтобы не снять чужой lock после
// истечения TTL первого процесса.
//
// Логика:
// 1. Acquire lock: SET NX EX 1800 с value = randomUUID(). Если занят → skip.
// 2. Find store by name — если нет, skip + warn.
// 3. POST /document-store/refresh/<id> с replaceExisting=true.
// 4. Release lock через Lua-script (atomic CAS by uuid).
// 5. onModuleDestroy: если lock наш — release; redis.quit() в try/catch.
// =============================================================================

@Injectable()
export class CatalogRefreshService implements OnModuleDestroy {
    private readonly logger = new Logger(CatalogRefreshService.name);
    private currentLockToken: string | null = null;

    constructor(
        @Inject(FLOWISE_CLIENT_TOKEN) private readonly flowise: FlowiseClient,
        @Inject(REDIS_CLIENT_TOKEN) private readonly redis: Redis,
    ) {}

    async onModuleDestroy(): Promise<void> {
        // Если текущий процесс держит lock (refresh in-flight при SIGTERM) —
        // освобождаем чтобы k8s rolling deploy не пропускал cron tick'и до TTL.
        if (this.currentLockToken !== null) {
            try {
                await this.releaseLock(this.currentLockToken);
            } catch (error) {
                this.logger.warn(
                    `failed to release lock on shutdown: ${formatFlowiseError(error)}`,
                );
            }
        }
        try {
            await this.redis.quit();
        } catch (error) {
            this.logger.warn(`redis.quit() failed (degraded shutdown): ${formatFlowiseError(error)}`);
        }
    }

    @Cron(CATALOG_REFRESH_CRON, { name: 'catalog-refresh' })
    async runScheduled(): Promise<void> {
        const result = await this.refresh();
        if (result.kind === 'success') {
            this.logger.log(
                `catalog-refresh completed: store=${result.storeName} elapsed=${result.elapsedMs}ms`,
            );
        } else if (result.kind === 'skipped') {
            this.logger.warn(
                `catalog-refresh skipped: reason=${result.reason}${result.error ? ` error=${result.error}` : ''}`,
            );
        } else {
            this.logger.error(
                `catalog-refresh failed: store=${result.storeName} error=${result.error}`,
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

            const storeId = findResult.store.id;
            try {
                const flowiseResponse = await this.flowise.request<TFlowiseRefreshResponse>(
                    ENDPOINTS.documentStoreRefresh(storeId),
                    {
                        method: 'POST',
                        body: { replaceExisting: true },
                    },
                );
                return {
                    kind: 'success',
                    storeId,
                    storeName,
                    elapsedMs: Date.now() - start,
                    flowiseResponse,
                };
            } catch (error) {
                return {
                    kind: 'failure',
                    storeId,
                    storeName,
                    elapsedMs: Date.now() - start,
                    error: formatFlowiseError(error),
                };
            }
        } finally {
            await this.releaseLock(lockToken);
            this.currentLockToken = null;
        }
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
        // Atomic CAS-release через Lua: удаляем lock только если value == token.
        // Защищает от снятия чужого lock'а если наш TTL истёк и другой
        // процесс уже acquire'нул свой.
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
}
