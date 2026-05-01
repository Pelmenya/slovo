import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import type { FlowiseClient } from '@slovo/flowise-client';
import { FlowiseError } from '@slovo/flowise-client';
import {
    CATALOG_REFRESH_LOCK_KEY,
    CATALOG_REFRESH_LOCK_RELEASE_LUA,
    CATALOG_REFRESH_LOCK_TTL_SEC,
    FLOWISE_CLIENT_TOKEN,
    REDIS_CLIENT_TOKEN,
} from './catalog-refresh.constants';
import { CatalogRefreshService } from './catalog-refresh.service';

type TFlowiseClientMock = {
    request: jest.Mock;
};

type TRedisClientMock = {
    set: jest.Mock;
    eval: jest.Mock;
    quit: jest.Mock;
};

const SAMPLE_STORE = {
    id: 'aec6b741',
    name: 'catalog-aquaphor',
    description: 'Каталог Аквафор',
    status: 'UPSERTED',
    loaders: [{ id: 'l1' }],
    whereUsed: [],
    embeddingConfig: '{"name":"openAIEmbeddings"}',
    vectorStoreConfig: '{"name":"postgres"}',
    recordManagerConfig: null,
    totalChunks: 912,
    totalChars: 772232,
};

function createFlowiseClientMock(): TFlowiseClientMock {
    return { request: jest.fn() };
}

function createRedisMock(): TRedisClientMock {
    return {
        set: jest.fn(),
        eval: jest.fn().mockResolvedValue(1),
        quit: jest.fn().mockResolvedValue('OK'),
    };
}

describe('CatalogRefreshService', () => {
    let service: CatalogRefreshService;
    let flowise: TFlowiseClientMock;
    let redis: TRedisClientMock;

    beforeEach(async () => {
        flowise = createFlowiseClientMock();
        redis = createRedisMock();

        const moduleRef = await Test.createTestingModule({
            providers: [
                CatalogRefreshService,
                { provide: FLOWISE_CLIENT_TOKEN, useValue: flowise as unknown as FlowiseClient },
                { provide: REDIS_CLIENT_TOKEN, useValue: redis as unknown as Redis },
            ],
        }).compile();

        service = moduleRef.get(CatalogRefreshService);
    });

    describe('happy path', () => {
        it('lock acquired → store найден → refresh успешен', async () => {
            redis.set.mockResolvedValueOnce('OK');
            flowise.request
                .mockResolvedValueOnce([SAMPLE_STORE])
                .mockResolvedValueOnce({ status: 'ok', processed: 912 });

            const result = await service.refresh();

            expect(result.kind).toBe('success');
            if (result.kind === 'success') {
                expect(result.storeId).toBe('aec6b741');
                expect(result.storeName).toBe('catalog-aquaphor');
                expect(result.flowiseResponse).toEqual({ status: 'ok', processed: 912 });
                expect(typeof result.elapsedMs).toBe('number');
            }

            // refresh должен пройти с replaceExisting=true
            expect(flowise.request).toHaveBeenNthCalledWith(
                2,
                expect.stringContaining('/refresh/aec6b741'),
                expect.objectContaining({
                    method: 'POST',
                    body: { replaceExisting: true },
                }),
            );

            // lock acquire с uuid value (не '1')
            const setCall = redis.set.mock.calls[0] as [string, string, string, number, string];
            expect(setCall[0]).toBe(CATALOG_REFRESH_LOCK_KEY);
            expect(setCall[1]).toMatch(/^[0-9a-f-]+$/); // uuid format
            expect(setCall[2]).toBe('EX');
            expect(setCall[3]).toBe(CATALOG_REFRESH_LOCK_TTL_SEC);
            expect(setCall[4]).toBe('NX');

            // release через Lua-CAS с тем же uuid
            expect(redis.eval).toHaveBeenCalledWith(
                CATALOG_REFRESH_LOCK_RELEASE_LUA,
                1,
                CATALOG_REFRESH_LOCK_KEY,
                setCall[1], // тот же uuid что был в set
            );
        });
    });

    describe('lock-held — повторный запуск пропускается', () => {
        it('Redis SET NX вернул null → skipped', async () => {
            redis.set.mockResolvedValueOnce(null);

            const result = await service.refresh();

            expect(result.kind).toBe('skipped');
            if (result.kind === 'skipped') {
                expect(result.reason).toBe('lock-held');
            }
            expect(flowise.request).not.toHaveBeenCalled();
            // eval НЕ вызывается — lock не наш, не должны делать release
            expect(redis.eval).not.toHaveBeenCalled();
        });
    });

    describe('store-not-found', () => {
        it('Flowise вернул empty list → skipped, lock освобождён через CAS', async () => {
            redis.set.mockResolvedValueOnce('OK');
            flowise.request.mockResolvedValueOnce([]);

            const result = await service.refresh();

            expect(result.kind).toBe('skipped');
            if (result.kind === 'skipped') {
                expect(result.reason).toBe('store-not-found');
                expect(result.error).toContain('catalog-aquaphor');
            }
            expect(redis.eval).toHaveBeenCalled();
        });

        it('GET /store вернул error → skipped с error message', async () => {
            redis.set.mockResolvedValueOnce('OK');
            flowise.request.mockRejectedValueOnce(new FlowiseError('Unauthorized', 401));

            const result = await service.refresh();

            expect(result.kind).toBe('skipped');
            if (result.kind === 'skipped') {
                expect(result.error).toContain('Unauthorized');
            }
            expect(redis.eval).toHaveBeenCalled();
        });
    });

    describe('refresh failure', () => {
        it('POST refresh упал → kind=failure, lock освобождён', async () => {
            redis.set.mockResolvedValueOnce('OK');
            flowise.request
                .mockResolvedValueOnce([SAMPLE_STORE])
                .mockRejectedValueOnce(new FlowiseError('Internal Server Error', 500));

            const result = await service.refresh();

            expect(result.kind).toBe('failure');
            if (result.kind === 'failure') {
                expect(result.error).toContain('Internal Server Error');
                expect(result.storeId).toBe('aec6b741');
            }
            expect(redis.eval).toHaveBeenCalled();
        });
    });

    describe('lock fencing — release через Lua CAS не снимает чужой lock', () => {
        it('каждый acquire генерирует новый uuid (fence-token)', async () => {
            redis.set.mockResolvedValue(null); // оба вызова видят занятый lock — но проверяем uuid'ы
            await service.refresh();
            await service.refresh();

            const firstToken = (redis.set.mock.calls[0] as [string, string, ...unknown[]])[1];
            const secondToken = (redis.set.mock.calls[1] as [string, string, ...unknown[]])[1];
            expect(firstToken).not.toBe(secondToken);
            expect(firstToken).toMatch(/^[0-9a-f-]+$/);
            expect(secondToken).toMatch(/^[0-9a-f-]+$/);
        });

        it('release передаёт ровно тот uuid что использовал acquire', async () => {
            redis.set.mockResolvedValueOnce('OK');
            flowise.request
                .mockResolvedValueOnce([SAMPLE_STORE])
                .mockResolvedValueOnce({ status: 'ok' });

            await service.refresh();

            const acquireToken = (redis.set.mock.calls[0] as [string, string, ...unknown[]])[1];
            const evalCall = redis.eval.mock.calls[0] as [string, number, string, string];
            expect(evalCall[3]).toBe(acquireToken);
        });
    });

    describe('runScheduled — cron entry point', () => {
        let logSpy: jest.SpyInstance;
        let warnSpy: jest.SpyInstance;
        let errorSpy: jest.SpyInstance;

        beforeEach(() => {
            logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
            warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
            errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
        });

        afterEach(() => {
            logSpy.mockRestore();
            warnSpy.mockRestore();
            errorSpy.mockRestore();
        });

        it('успешный refresh → logger.log с completed', async () => {
            redis.set.mockResolvedValueOnce('OK');
            flowise.request
                .mockResolvedValueOnce([SAMPLE_STORE])
                .mockResolvedValueOnce({ status: 'ok' });

            await service.runScheduled();

            expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('completed'));
            expect(warnSpy).not.toHaveBeenCalled();
            expect(errorSpy).not.toHaveBeenCalled();
        });

        it('lock-held → logger.warn с skipped', async () => {
            redis.set.mockResolvedValueOnce(null);

            await service.runScheduled();

            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('skipped'));
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('lock-held'));
            expect(logSpy).not.toHaveBeenCalled();
            expect(errorSpy).not.toHaveBeenCalled();
        });

        it('failure → logger.error (не throw, иначе крашит scheduler)', async () => {
            redis.set.mockResolvedValueOnce('OK');
            flowise.request
                .mockResolvedValueOnce([SAMPLE_STORE])
                .mockRejectedValueOnce(new FlowiseError('Server error', 500));

            await expect(service.runScheduled()).resolves.toBeUndefined();
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('failed'));
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Server error'));
        });
    });

    describe('onModuleDestroy — graceful shutdown', () => {
        it('без активного lock → только redis.quit()', async () => {
            await service.onModuleDestroy();
            expect(redis.eval).not.toHaveBeenCalled(); // не было release
            expect(redis.quit).toHaveBeenCalled();
        });

        it('с активным lock (refresh in-flight при SIGTERM) → release + quit', async () => {
            redis.set.mockResolvedValueOnce('OK');
            // Симулируем зависший findStoreByName — lock ещё не released
            let resolveStore: (v: unknown) => void;
            const storesPromise = new Promise((r) => {
                resolveStore = r;
            });
            flowise.request.mockReturnValueOnce(storesPromise);

            const refreshPromise = service.refresh();
            // Дать event-loop'у пройти SET и записать currentLockToken
            await new Promise((r) => setImmediate(r));

            // SIGTERM пришёл во время refresh
            await service.onModuleDestroy();

            expect(redis.eval).toHaveBeenCalled(); // lock освобождён в onModuleDestroy
            expect(redis.quit).toHaveBeenCalled();

            // Доразрешаем refresh чтобы Promise не висел
            resolveStore!([]);
            await refreshPromise;
        });

        it('redis.quit() упал (degraded shutdown) → warn, не throw', async () => {
            const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
            redis.quit.mockRejectedValueOnce(new Error('Connection lost'));

            await expect(service.onModuleDestroy()).resolves.toBeUndefined();
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('redis.quit'));
            warnSpy.mockRestore();
        });
    });
});
