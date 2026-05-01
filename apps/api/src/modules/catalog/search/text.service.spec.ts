import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import type { FlowiseClient } from '@slovo/flowise-client';
import { FlowiseError } from '@slovo/flowise-client';
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
import { TextSearchService } from './text.service';

type TFlowiseClientMock = { request: jest.Mock };
type TRedisClientMock = {
    get: jest.Mock;
    set: jest.Mock;
    quit: jest.Mock;
};
type TStorageServiceMock = { getPresignedDownloadUrl: jest.Mock };

const TEST_STORE_ID = 'aec6b741-test';

const SAMPLE_FLOWISE_DOC = {
    id: 'chunk-42',
    pageContent: 'Товар: Аквафор DWM-101S\nОписание: фильтр обратного осмоса',
    metadata: {
        externalId: 'moysklad-uuid-1',
        externalType: 'product',
        imageUrls: [
            'catalogs/aquaphor/images/abc/sha111.jpg',
            'catalogs/aquaphor/images/abc/sha222.jpg',
        ],
    },
    chunkNo: 1,
};

// Pre-cache storeId в service чтобы happy-path тесты не дёргали первый
// flowise.request на listing stores. Само разрешение покрыто отдельным
// describe 'storeId resolution'.
function preCacheStoreId(svc: TextSearchService, id = TEST_STORE_ID): void {
    (svc as unknown as { storeIdPromise: Promise<string> | null }).storeIdPromise =
        Promise.resolve(id);
}

function createFlowiseClientMock(): TFlowiseClientMock {
    return { request: jest.fn() };
}

function createRedisMock(): TRedisClientMock {
    return {
        get: jest.fn(),
        set: jest.fn().mockResolvedValue('OK'),
        quit: jest.fn().mockResolvedValue('OK'),
    };
}

function createStorageMock(): TStorageServiceMock {
    return { getPresignedDownloadUrl: jest.fn() };
}

describe('TextSearchService', () => {
    let service: TextSearchService;
    let flowise: TFlowiseClientMock;
    let redis: TRedisClientMock;
    let storage: TStorageServiceMock;

    beforeEach(async () => {
        flowise = createFlowiseClientMock();
        redis = createRedisMock();
        storage = createStorageMock();

        const moduleRef = await Test.createTestingModule({
            providers: [
                TextSearchService,
                { provide: FLOWISE_CLIENT_TOKEN, useValue: flowise as unknown as FlowiseClient },
                { provide: REDIS_CLIENT_TOKEN, useValue: redis as unknown as Redis },
                { provide: StorageService, useValue: storage as unknown as StorageService },
            ],
        }).compile();

        service = moduleRef.get(TextSearchService);
        preCacheStoreId(service);
    });

    describe('search — happy path', () => {
        it('делает vectorstoreQuery и обогащает doc presigned URL\'ами', async () => {
            flowise.request.mockResolvedValueOnce({
                timeTaken: 312,
                docs: [SAMPLE_FLOWISE_DOC],
            });
            redis.get.mockResolvedValue(null);
            storage.getPresignedDownloadUrl
                .mockResolvedValueOnce('https://signed/sha111')
                .mockResolvedValueOnce('https://signed/sha222');

            const result = await service.search('фильтр для жёсткой воды');

            expect(result.count).toBe(1);
            expect(result.timeTakenMs).toBe(312);
            expect(result.docs[0].id).toBe('chunk-42');
            expect(result.docs[0].pageContent).toBe(SAMPLE_FLOWISE_DOC.pageContent);
            expect(result.docs[0].imageUrls).toEqual([
                'https://signed/sha111',
                'https://signed/sha222',
            ]);
            // metadata whitelist: imageUrls отфильтровано (отдаётся отдельным
            // полем как presigned URLs, не raw S3-keys)
            expect(result.docs[0].metadata).toEqual({
                externalId: 'moysklad-uuid-1',
                externalType: 'product',
            });
        });

        it('передаёт storeId, query, default topK во Flowise', async () => {
            flowise.request.mockResolvedValueOnce({ timeTaken: 100, docs: [] });

            await service.search('тест');

            expect(flowise.request).toHaveBeenCalledWith(
                expect.stringContaining('/document-store/vectorstore/query'),
                expect.objectContaining({
                    method: 'POST',
                    body: {
                        storeId: TEST_STORE_ID,
                        query: 'тест',
                        topK: CATALOG_DEFAULT_TOP_K,
                    },
                }),
            );
        });

        it('передаёт переопределённый topK когда передан', async () => {
            flowise.request.mockResolvedValueOnce({ timeTaken: 100, docs: [] });

            await service.search('тест', 25);

            expect(flowise.request).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    body: expect.objectContaining({ topK: 25 }),
                }),
            );
        });

        it('возвращает пустой результат когда Flowise отдал пустой docs', async () => {
            flowise.request.mockResolvedValueOnce({ timeTaken: 50, docs: [] });

            const result = await service.search('что-то');

            expect(result.count).toBe(0);
            expect(result.docs).toEqual([]);
            expect(redis.get).not.toHaveBeenCalled();
            expect(storage.getPresignedDownloadUrl).not.toHaveBeenCalled();
        });
    });

    describe('storeId resolution — name lookup на старте', () => {
        beforeEach(() => {
            // Сбрасываем pre-cache чтобы протестировать сам lookup
            (service as unknown as { storeIdPromise: Promise<string> | null }).storeIdPromise = null;
        });

        it('первый search → list stores → найти по name → cache id', async () => {
            flowise.request
                .mockResolvedValueOnce([
                    { id: 'other-id', name: 'other-store' },
                    { id: 'aec6b741-real', name: CATALOG_AQUAPHOR_STORE_NAME },
                ])
                .mockResolvedValueOnce({ timeTaken: 100, docs: [] });

            await service.search('тест');

            // первый вызов — listing stores
            expect(flowise.request).toHaveBeenNthCalledWith(
                1,
                expect.stringContaining('/document-store/store'),
            );
            // второй вызов — query с найденным id
            expect(flowise.request).toHaveBeenNthCalledWith(
                2,
                expect.stringContaining('/vectorstore/query'),
                expect.objectContaining({
                    body: expect.objectContaining({ storeId: 'aec6b741-real' }),
                }),
            );
        });

        it('второй search использует cached storeId (single-flight)', async () => {
            flowise.request
                .mockResolvedValueOnce([{ id: 'aec6b741-real', name: CATALOG_AQUAPHOR_STORE_NAME }])
                .mockResolvedValueOnce({ timeTaken: 100, docs: [] })
                .mockResolvedValueOnce({ timeTaken: 100, docs: [] });

            await service.search('первый');
            await service.search('второй');

            // Первый вызов — list, потом 2 query — итого 3, не 4
            expect(flowise.request).toHaveBeenCalledTimes(3);
        });

        it('store не найден → throw, следующий request делает retry', async () => {
            flowise.request
                .mockResolvedValueOnce([{ id: 'wrong', name: 'wrong-name' }])
                // retry — теперь нашёлся
                .mockResolvedValueOnce([{ id: 'aec6b741-real', name: CATALOG_AQUAPHOR_STORE_NAME }])
                .mockResolvedValueOnce({ timeTaken: 100, docs: [] });

            await expect(service.search('первый')).rejects.toThrow(/not found/);

            // retry должен сработать (storeIdPromise обнулился на ошибке)
            const result = await service.search('второй');
            expect(result.count).toBe(0);
        });

        it('Flowise list упал → ошибка пробрасывается, retry на следующий request', async () => {
            flowise.request
                .mockRejectedValueOnce(new FlowiseError('Internal Server Error', 500))
                .mockResolvedValueOnce([{ id: 'aec6b741-real', name: CATALOG_AQUAPHOR_STORE_NAME }])
                .mockResolvedValueOnce({ timeTaken: 100, docs: [] });

            await expect(service.search('первый')).rejects.toBeInstanceOf(FlowiseError);

            // retry успешен
            await expect(service.search('второй')).resolves.toBeDefined();
        });
    });

    describe('metadata whitelist (info-leak защита)', () => {
        it('отдаёт только whitelisted поля, лишние отбрасывает', async () => {
            flowise.request.mockResolvedValueOnce({
                timeTaken: 100,
                docs: [
                    {
                        ...SAMPLE_FLOWISE_DOC,
                        metadata: {
                            // whitelisted
                            externalId: 'mu-1',
                            externalType: 'product',
                            externalSource: 'moysklad',
                            categoryPath: 'Фильтры/RO',
                            name: 'Аквафор',
                            description: 'desc',
                            salePriceKopecks: 100000,
                            rangForApp: 5,
                            // НЕ whitelisted (must be filtered)
                            cost: 50000,
                            margin: 0.5,
                            supplierInternalId: 'leak-this',
                            imageUrls: ['ok.jpg'],
                        },
                    },
                ],
            });
            redis.get.mockResolvedValue(null);
            storage.getPresignedDownloadUrl.mockResolvedValue('https://signed/ok');

            const result = await service.search('тест');

            expect(result.docs[0].metadata).toEqual({
                externalId: 'mu-1',
                externalType: 'product',
                externalSource: 'moysklad',
                categoryPath: 'Фильтры/RO',
                name: 'Аквафор',
                description: 'desc',
                salePriceKopecks: 100000,
                rangForApp: 5,
            });
            expect(result.docs[0].metadata).not.toHaveProperty('cost');
            expect(result.docs[0].metadata).not.toHaveProperty('margin');
            expect(result.docs[0].metadata).not.toHaveProperty('supplierInternalId');
            expect(result.docs[0].metadata).not.toHaveProperty('imageUrls');
        });

        it('пустая metadata → пустой объект (не throw)', async () => {
            flowise.request.mockResolvedValueOnce({
                timeTaken: 100,
                docs: [{ ...SAMPLE_FLOWISE_DOC, metadata: {} }],
            });

            const result = await service.search('тест');

            expect(result.docs[0].metadata).toEqual({});
        });
    });

    describe('presigned URL cache — Redis-level', () => {
        it('cache hit → не дёргает S3, не пишет в cache повторно', async () => {
            flowise.request.mockResolvedValueOnce({
                timeTaken: 100,
                docs: [SAMPLE_FLOWISE_DOC],
            });
            redis.get.mockResolvedValue('https://cached/url');

            const result = await service.search('тест');

            expect(result.docs[0].imageUrls).toEqual([
                'https://cached/url',
                'https://cached/url',
            ]);
            expect(storage.getPresignedDownloadUrl).not.toHaveBeenCalled();
            expect(redis.set).not.toHaveBeenCalled();
        });

        it('cache miss → S3 presign, потом SET с TTL', async () => {
            flowise.request.mockResolvedValueOnce({
                timeTaken: 100,
                docs: [
                    {
                        ...SAMPLE_FLOWISE_DOC,
                        metadata: { imageUrls: ['catalogs/aquaphor/images/x/single.jpg'] },
                    },
                ],
            });
            redis.get.mockResolvedValueOnce(null);
            storage.getPresignedDownloadUrl.mockResolvedValueOnce('https://signed/single');

            await service.search('тест');

            expect(storage.getPresignedDownloadUrl).toHaveBeenCalledWith(
                'catalogs/aquaphor/images/x/single.jpg',
                { expiresInSeconds: CATALOG_PRESIGNED_URL_TTL_SEC },
            );
            expect(redis.set).toHaveBeenCalledWith(
                `${CATALOG_PRESIGNED_CACHE_KEY_PREFIX}catalogs/aquaphor/images/x/single.jpg`,
                'https://signed/single',
                'EX',
                CATALOG_PRESIGNED_CACHE_TTL_SEC,
            );
        });

        it('cache key — exact prefix + S3-key', async () => {
            flowise.request.mockResolvedValueOnce({
                timeTaken: 100,
                docs: [
                    {
                        ...SAMPLE_FLOWISE_DOC,
                        metadata: { imageUrls: ['some/key.jpg'] },
                    },
                ],
            });
            redis.get.mockResolvedValueOnce(null);
            storage.getPresignedDownloadUrl.mockResolvedValueOnce('https://signed/url');

            await service.search('тест');

            expect(redis.get).toHaveBeenCalledWith(
                `${CATALOG_PRESIGNED_CACHE_KEY_PREFIX}some/key.jpg`,
            );
        });
    });

    describe('intra-request dedup — один S3-key в нескольких docs', () => {
        it('тот же ключ в 5 docs → resolveOne вызвался один раз', async () => {
            const sharedKey = 'catalogs/aquaphor/images/shared/sha-x.jpg';
            flowise.request.mockResolvedValueOnce({
                timeTaken: 100,
                docs: [1, 2, 3, 4, 5].map((n) => ({
                    id: `chunk-${n}`,
                    pageContent: `chunk ${n}`,
                    metadata: { imageUrls: [sharedKey] },
                    chunkNo: n,
                })),
            });
            redis.get.mockResolvedValue(null);
            storage.getPresignedDownloadUrl.mockResolvedValue('https://signed/shared');

            const result = await service.search('тест');

            expect(result.docs).toHaveLength(5);
            // Каждый doc получил presigned URL
            for (const doc of result.docs) {
                expect(doc.imageUrls).toEqual(['https://signed/shared']);
            }
            // Но S3 sign дёрнули один раз (level-1 dedup)
            expect(storage.getPresignedDownloadUrl).toHaveBeenCalledTimes(1);
        });

        it('разные ключи в одном docs → каждый resolveOne один раз', async () => {
            flowise.request.mockResolvedValueOnce({
                timeTaken: 100,
                docs: [
                    {
                        id: 'c1',
                        pageContent: 'c1',
                        metadata: { imageUrls: ['k1.jpg', 'k2.jpg'] },
                        chunkNo: 1,
                    },
                    {
                        id: 'c2',
                        pageContent: 'c2',
                        metadata: { imageUrls: ['k1.jpg', 'k3.jpg'] },
                        chunkNo: 2,
                    },
                ],
            });
            redis.get.mockResolvedValue(null);
            storage.getPresignedDownloadUrl.mockImplementation(
                (k: string) => Promise.resolve(`https://signed/${k}`),
            );

            const result = await service.search('тест');

            // 3 уникальных ключа (k1, k2, k3) → 3 sign calls (не 4)
            expect(storage.getPresignedDownloadUrl).toHaveBeenCalledTimes(3);
            expect(result.docs[0].imageUrls).toEqual(['https://signed/k1.jpg', 'https://signed/k2.jpg']);
            expect(result.docs[1].imageUrls).toEqual(['https://signed/k1.jpg', 'https://signed/k3.jpg']);
        });
    });

    describe('inter-request single-flight — concurrent searches на cold key', () => {
        it('два параллельных search\'а на тот же ключ → один S3 sign', async () => {
            // Симулируем медленный S3 sign — 50мс
            let resolveSign: (v: string) => void;
            const slowSign = new Promise<string>((r) => {
                resolveSign = r;
            });
            storage.getPresignedDownloadUrl.mockReturnValueOnce(slowSign);
            redis.get.mockResolvedValue(null);

            // Оба запроса дёргают одинаковый key
            flowise.request
                .mockResolvedValueOnce({
                    timeTaken: 100,
                    docs: [{ ...SAMPLE_FLOWISE_DOC, metadata: { imageUrls: ['shared.jpg'] } }],
                })
                .mockResolvedValueOnce({
                    timeTaken: 100,
                    docs: [{ ...SAMPLE_FLOWISE_DOC, metadata: { imageUrls: ['shared.jpg'] } }],
                });

            const search1 = service.search('первый');
            const search2 = service.search('второй');

            // Дать event loop'у пройти flowise.request оба раза, но S3 sign
            // зависнет в ожидании resolveSign
            await new Promise((r) => setImmediate(r));

            // S3 sign должен быть в полёте только ОДИН раз — second search
            // увидел inflight Promise и ждёт его
            expect(storage.getPresignedDownloadUrl).toHaveBeenCalledTimes(1);

            resolveSign!('https://signed/shared');
            const [r1, r2] = await Promise.all([search1, search2]);

            // Оба получили один и тот же URL
            expect(r1.docs[0].imageUrls).toEqual(['https://signed/shared']);
            expect(r2.docs[0].imageUrls).toEqual(['https://signed/shared']);
            // Sign call всё ещё один (cache hit на втором поскольку set уже произошёл)
            expect(storage.getPresignedDownloadUrl).toHaveBeenCalledTimes(1);
        });
    });

    describe('metadata edge cases', () => {
        it('imageUrls отсутствует → пустой массив', async () => {
            flowise.request.mockResolvedValueOnce({
                timeTaken: 100,
                docs: [{ ...SAMPLE_FLOWISE_DOC, metadata: { externalId: 'x' } }],
            });

            const result = await service.search('тест');

            expect(result.docs[0].imageUrls).toEqual([]);
            expect(storage.getPresignedDownloadUrl).not.toHaveBeenCalled();
        });

        it('imageUrls — не array (string) → пустой массив, не throw', async () => {
            flowise.request.mockResolvedValueOnce({
                timeTaken: 100,
                docs: [{ ...SAMPLE_FLOWISE_DOC, metadata: { imageUrls: 'broken-string' } }],
            });

            const result = await service.search('тест');

            expect(result.docs[0].imageUrls).toEqual([]);
        });

        it('imageUrls — array с не-string элементами → отфильтровывает', async () => {
            flowise.request.mockResolvedValueOnce({
                timeTaken: 100,
                docs: [
                    {
                        ...SAMPLE_FLOWISE_DOC,
                        metadata: { imageUrls: ['ok.jpg', 123, null, '', 'good.jpg'] },
                    },
                ],
            });
            redis.get.mockResolvedValue(null);
            storage.getPresignedDownloadUrl.mockImplementation(
                (k: string) => Promise.resolve(`https://signed/${k}`),
            );

            const result = await service.search('тест');

            // Только две валидных строки прошли filter (123, null, '' отброшены)
            expect(storage.getPresignedDownloadUrl).toHaveBeenCalledTimes(2);
            expect(result.docs[0].imageUrls).toHaveLength(2);
        });
    });

    describe('S3-key validation (path-injection защита)', () => {
        async function searchWithImageKeys(keys: unknown[]): Promise<string[]> {
            flowise.request.mockResolvedValueOnce({
                timeTaken: 100,
                docs: [{ ...SAMPLE_FLOWISE_DOC, metadata: { imageUrls: keys } }],
            });
            redis.get.mockResolvedValue(null);
            storage.getPresignedDownloadUrl.mockImplementation(
                (k: string) => Promise.resolve(`https://signed/${k}`),
            );
            const result = await service.search('тест');
            return result.docs[0].imageUrls;
        }

        it('отбрасывает path traversal (../etc/passwd)', async () => {
            const urls = await searchWithImageKeys(['../etc/passwd', 'ok.jpg']);
            expect(urls).toEqual(['https://signed/ok.jpg']);
        });

        it('отбрасывает leading slash (абсолютный путь)', async () => {
            const urls = await searchWithImageKeys(['/etc/passwd', 'ok.jpg']);
            expect(urls).toEqual(['https://signed/ok.jpg']);
        });

        it('отбрасывает leading dot (скрытый файл / относительный путь)', async () => {
            const urls = await searchWithImageKeys(['.hidden.jpg', 'ok.jpg']);
            expect(urls).toEqual(['https://signed/ok.jpg']);
        });

        it('отбрасывает абсолютный URL (https://attacker.com/...)', async () => {
            const urls = await searchWithImageKeys([
                'https://attacker.com/payload',
                'ok.jpg',
            ]);
            expect(urls).toEqual(['https://signed/ok.jpg']);
        });

        it('отбрасывает .. как отдельный сегмент в середине пути', async () => {
            const urls = await searchWithImageKeys([
                'catalogs/../secrets/passwd',
                'catalogs/aquaphor/images/ok.jpg',
            ]);
            expect(urls).toEqual(['https://signed/catalogs/aquaphor/images/ok.jpg']);
        });

        it('допускает .. как часть имени (a..b — не path traversal)', async () => {
            const urls = await searchWithImageKeys(['catalogs/a..b/ok.jpg']);
            expect(urls).toEqual(['https://signed/catalogs/a..b/ok.jpg']);
        });

        it('отбрасывает не-ASCII (\\0, control chars, кириллица)', async () => {
            const urls = await searchWithImageKeys([
                'катал/ok.jpg',
                'ok .jpg',
                'ok.jpg',
            ]);
            expect(urls).toEqual(['https://signed/ok.jpg']);
        });

        it('отбрасывает строку > 1024 chars', async () => {
            const longKey = 'a'.repeat(1025);
            const urls = await searchWithImageKeys([longKey, 'ok.jpg']);
            expect(urls).toEqual(['https://signed/ok.jpg']);
        });

        it('допускает валидные относительные пути с дефисами/подчёркиваниями', async () => {
            const urls = await searchWithImageKeys([
                'catalogs/aquaphor/images/abc-123_xyz/sha256-def.jpg',
            ]);
            expect(urls).toEqual([
                'https://signed/catalogs/aquaphor/images/abc-123_xyz/sha256-def.jpg',
            ]);
        });
    });

    describe('error propagation', () => {
        it('Flowise упал → ошибка пробрасывается клиенту', async () => {
            flowise.request.mockRejectedValueOnce(new FlowiseError('Internal Server Error', 500));

            await expect(service.search('тест')).rejects.toBeInstanceOf(FlowiseError);
        });

        it('S3 presign упал → ошибка пробрасывается (один битый key валит весь search)', async () => {
            flowise.request.mockResolvedValueOnce({
                timeTaken: 100,
                docs: [SAMPLE_FLOWISE_DOC],
            });
            redis.get.mockResolvedValue(null);
            storage.getPresignedDownloadUrl.mockRejectedValueOnce(new Error('S3 unreachable'));

            await expect(service.search('тест')).rejects.toThrow('S3 unreachable');
        });
    });

    describe('onModuleDestroy — graceful shutdown', () => {
        it('вызывает redis.quit()', async () => {
            await service.onModuleDestroy();
            expect(redis.quit).toHaveBeenCalled();
        });

        it('redis.quit() упал → warn, не throw', async () => {
            const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
            redis.quit.mockRejectedValueOnce(new Error('Connection lost'));

            await expect(service.onModuleDestroy()).resolves.toBeUndefined();
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('redis.quit'));
            warnSpy.mockRestore();
        });
    });
});
