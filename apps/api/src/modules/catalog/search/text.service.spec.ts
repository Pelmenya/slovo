import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import type { FlowiseClient } from '@slovo/flowise-client';
import { FlowiseError } from '@slovo/flowise-client';
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
import { TextSearchService } from './text.service';

type TFlowiseClientMock = { request: jest.Mock };
type TRedisClientMock = {
    get: jest.Mock;
    set: jest.Mock;
    quit: jest.Mock;
};
type TStorageServiceMock = { getPresignedDownloadUrl: jest.Mock };

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
                {
                    provide: CATALOG_STORAGE_SERVICE_TOKEN,
                    useValue: storage as unknown as StorageService,
                },
            ],
        }).compile();

        service = moduleRef.get(TextSearchService);
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
            expect(result.docs[0]).toEqual({
                id: 'chunk-42',
                pageContent: SAMPLE_FLOWISE_DOC.pageContent,
                metadata: SAMPLE_FLOWISE_DOC.metadata,
                imageUrls: ['https://signed/sha111', 'https://signed/sha222'],
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
                        storeId: CATALOG_AQUAPHOR_STORE_ID,
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

    describe('presigned URL cache', () => {
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
            storage.getPresignedDownloadUrl.mockResolvedValue('https://signed/url');

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
                'ok .jpg',
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
