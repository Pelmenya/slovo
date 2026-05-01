import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import type { FlowiseClient } from '@slovo/flowise-client';
import { FlowiseError } from '@slovo/flowise-client';
import {
    CatalogRefreshService,
    FLOWISE_CLIENT_TOKEN,
    REDIS_CLIENT_TOKEN,
} from './catalog-refresh.service';

type TFlowiseClientMock = {
    request: jest.Mock;
};

type TRedisClientMock = {
    set: jest.Mock;
    del: jest.Mock;
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

describe('CatalogRefreshService', () => {
    let service: CatalogRefreshService;
    let flowise: TFlowiseClientMock;
    let redis: TRedisClientMock;

    beforeEach(async () => {
        flowise = { request: jest.fn() };
        redis = {
            set: jest.fn(),
            del: jest.fn().mockResolvedValue(1),
            quit: jest.fn().mockResolvedValue('OK'),
        };

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
                .mockResolvedValueOnce([SAMPLE_STORE]) // GET /document-store/store
                .mockResolvedValueOnce({ status: 'ok', processed: 912 }); // POST refresh

            const result = await service.refresh();

            expect(result.success).toBe(true);
            expect(result.storeId).toBe('aec6b741');
            expect(result.storeName).toBe('catalog-aquaphor');
            expect(result.flowiseResponse).toEqual({ status: 'ok', processed: 912 });
            expect(typeof result.elapsedMs).toBe('number');

            // refresh должен пройти с replaceExisting=true
            const refreshCall = flowise.request.mock.calls[1] as [string, { method: string; body: { replaceExisting: boolean } }];
            expect(refreshCall[0]).toContain('/refresh/aec6b741');
            expect(refreshCall[1].method).toBe('POST');
            expect(refreshCall[1].body.replaceExisting).toBe(true);

            // lock acquire + release
            expect(redis.set).toHaveBeenCalledWith(
                'slovo:catalog-refresh:lock',
                '1',
                'EX',
                1800,
                'NX',
            );
            expect(redis.del).toHaveBeenCalledWith('slovo:catalog-refresh:lock');
        });
    });

    describe('lock-held — повторный запуск пропускается', () => {
        it('Redis SET NX вернул null → skipped', async () => {
            redis.set.mockResolvedValueOnce(null);

            const result = await service.refresh();

            expect(result.success).toBe(false);
            expect(result.skipped).toBe('lock-held');
            expect(flowise.request).not.toHaveBeenCalled();
            // del НЕ вызывается — мы не держим lock, не должны удалять
            expect(redis.del).not.toHaveBeenCalled();
        });
    });

    describe('store-not-found', () => {
        it('Flowise вернул empty list → skipped store-not-found, lock освобождён', async () => {
            redis.set.mockResolvedValueOnce('OK');
            flowise.request.mockResolvedValueOnce([]);

            const result = await service.refresh();

            expect(result.success).toBe(false);
            expect(result.skipped).toBe('store-not-found');
            expect(result.error).toContain('catalog-aquaphor');
            expect(redis.del).toHaveBeenCalled(); // lock освобождён
        });

        it('GET /store вернул error → store-not-found с error message', async () => {
            redis.set.mockResolvedValueOnce('OK');
            flowise.request.mockRejectedValueOnce(new FlowiseError('Unauthorized', 401));

            const result = await service.refresh();

            expect(result.success).toBe(false);
            expect(result.skipped).toBe('store-not-found');
            expect(result.error).toContain('Unauthorized');
            expect(redis.del).toHaveBeenCalled();
        });
    });

    describe('refresh failure', () => {
        it('POST refresh упал → success=false с error, lock освобождён', async () => {
            redis.set.mockResolvedValueOnce('OK');
            flowise.request
                .mockResolvedValueOnce([SAMPLE_STORE])
                .mockRejectedValueOnce(new FlowiseError('Internal Server Error', 500));

            const result = await service.refresh();

            expect(result.success).toBe(false);
            expect(result.skipped).toBeUndefined();
            expect(result.error).toContain('Internal Server Error');
            expect(result.storeId).toBe('aec6b741'); // store найден, error на refresh шаге
            expect(redis.del).toHaveBeenCalled();
        });
    });

    describe('runScheduled — cron entry point', () => {
        it('успешный refresh → success log', async () => {
            redis.set.mockResolvedValueOnce('OK');
            flowise.request
                .mockResolvedValueOnce([SAMPLE_STORE])
                .mockResolvedValueOnce({ status: 'ok' });

            await expect(service.runScheduled()).resolves.toBeUndefined();
        });

        it('lock-held → warn log', async () => {
            redis.set.mockResolvedValueOnce(null);
            await expect(service.runScheduled()).resolves.toBeUndefined();
        });

        it('failure → error log (не throw, иначе крашит scheduler)', async () => {
            redis.set.mockResolvedValueOnce('OK');
            flowise.request
                .mockResolvedValueOnce([SAMPLE_STORE])
                .mockRejectedValueOnce(new FlowiseError('Server error', 500));
            await expect(service.runScheduled()).resolves.toBeUndefined();
        });
    });

    describe('onModuleDestroy', () => {
        it('закрывает Redis connection', async () => {
            await service.onModuleDestroy();
            expect(redis.quit).toHaveBeenCalled();
        });
    });
});
