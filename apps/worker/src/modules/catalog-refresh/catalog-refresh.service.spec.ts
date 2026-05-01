import { Readable } from 'node:stream';
import { Logger, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import { PrismaService } from '@slovo/database';
import type { FlowiseClient } from '@slovo/flowise-client';
import { FlowiseError } from '@slovo/flowise-client';
import { StorageService } from '@slovo/storage';
import {
    CATALOG_PAYLOAD_KEY,
    CATALOG_REFRESH_LOCK_KEY,
    CATALOG_REFRESH_LOCK_RELEASE_LUA,
    CATALOG_SPLITTER_CHUNK_OVERLAP,
    CATALOG_SPLITTER_CHUNK_SIZE,
    FLOWISE_CLIENT_TOKEN,
    REDIS_CLIENT_TOKEN,
} from './catalog-refresh.constants';
import { CatalogRefreshService } from './catalog-refresh.service';
import type { TBulkIngestPayload } from './t-bulk-ingest-payload';

type TFlowiseClientMock = { request: jest.Mock };
type TRedisClientMock = {
    set: jest.Mock;
    eval: jest.Mock;
    quit: jest.Mock;
};
type TStorageServiceMock = { getObjectStream: jest.Mock };
type TPrismaServiceMock = { $executeRawUnsafe: jest.Mock };

const SAMPLE_STORE = {
    id: 'aec6b741',
    name: 'catalog-aquaphor',
    description: 'Каталог Аквафор',
    status: 'UPSERTED',
    loaders: [
        { id: 'old-broken-s3', loaderId: 'S3', loaderName: 'S3', totalChunks: 912 },
    ],
    whereUsed: [],
    embeddingConfig:
        '{"name":"openAIEmbeddings","config":{"modelName":"text-embedding-3-small","dimensions":1536}}',
    vectorStoreConfig:
        '{"name":"postgres","config":{"host":"slovo-postgres","port":5432,"tableName":"catalog_chunks"}}',
    recordManagerConfig: null,
    totalChunks: 912,
    totalChars: 772232,
};

const SAMPLE_PAYLOAD: TBulkIngestPayload = {
    syncMode: 'full',
    sourceSystem: 'moysklad',
    syncedAt: '2026-05-01T10:00:00.000Z',
    items: [
        {
            externalId: 'mu-001',
            externalSource: 'moysklad',
            externalType: 'product',
            externalUpdatedAt: '2026-04-30T12:00:00Z',
            name: 'Аквафор DWM-101S',
            description: 'Обратный осмос',
            salePriceKopecks: 4500000,
            categoryPath: 'Фильтры/Обратный осмос',
            isVisible: true,
            rangForApp: 5,
            imageUrls: ['catalogs/aquaphor/images/mu-001/sha1.jpg'],
            groupImageKeys: [],
            relatedServices: [],
            relatedComponents: [],
            contentForEmbedding: 'Товар: Аквафор DWM-101S\nОписание: Обратный осмос',
            contentHash: 'hash-001',
        },
        {
            externalId: 'mu-002',
            externalSource: 'moysklad',
            externalType: 'cartridge',
            externalUpdatedAt: '2026-04-30T12:00:00Z',
            name: 'Картридж K1-07',
            description: 'Префильтр',
            salePriceKopecks: 70000,
            categoryPath: 'Картриджи',
            isVisible: true,
            rangForApp: null,
            imageUrls: [],
            groupImageKeys: [],
            relatedServices: [],
            relatedComponents: [],
            contentForEmbedding: 'Товар: Картридж K1-07',
            contentHash: 'hash-002',
        },
    ],
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

function createStorageMock(): TStorageServiceMock {
    return { getObjectStream: jest.fn() };
}

function createPrismaMock(): TPrismaServiceMock {
    return { $executeRawUnsafe: jest.fn().mockResolvedValue(0) };
}

// Хелпер: создать Readable из строки (JSON payload).
function readableFrom(content: string): Readable {
    return Readable.from([Buffer.from(content, 'utf-8')]);
}

// Хелпер: подготовить mock'и так, чтобы happy-path до upsert'а прошёл.
function setupHappyPathMocks(
    flowise: TFlowiseClientMock,
    redis: TRedisClientMock,
    storage: TStorageServiceMock,
): void {
    redis.set.mockResolvedValueOnce('OK');
    flowise.request
        // 1. list stores
        .mockResolvedValueOnce([SAMPLE_STORE])
        // 2. wipe loader (DELETE)
        .mockResolvedValueOnce({ success: true });
    storage.getObjectStream.mockResolvedValueOnce({
        key: CATALOG_PAYLOAD_KEY,
        body: readableFrom(JSON.stringify(SAMPLE_PAYLOAD)),
        contentType: 'application/json',
    });
}

describe('CatalogRefreshService', () => {
    let service: CatalogRefreshService;
    let flowise: TFlowiseClientMock;
    let redis: TRedisClientMock;
    let storage: TStorageServiceMock;
    let prisma: TPrismaServiceMock;

    beforeEach(async () => {
        flowise = createFlowiseClientMock();
        redis = createRedisMock();
        storage = createStorageMock();
        prisma = createPrismaMock();

        const moduleRef = await Test.createTestingModule({
            providers: [
                CatalogRefreshService,
                { provide: FLOWISE_CLIENT_TOKEN, useValue: flowise as unknown as FlowiseClient },
                { provide: REDIS_CLIENT_TOKEN, useValue: redis as unknown as Redis },
                { provide: StorageService, useValue: storage as unknown as StorageService },
                { provide: PrismaService, useValue: prisma as unknown as PrismaService },
            ],
        }).compile();

        service = moduleRef.get(CatalogRefreshService);
    });

    describe('happy path — slovo orchestrate', () => {
        it('lock → list → wipe → download → parse → per-item upsert → success', async () => {
            setupHappyPathMocks(flowise, redis, storage);
            // 2 items × 1 upsert each
            flowise.request
                .mockResolvedValueOnce({ numAdded: 1, addedDocs: [] })
                .mockResolvedValueOnce({ numAdded: 1, addedDocs: [] });

            const result = await service.refresh();

            expect(result.kind).toBe('success');
            if (result.kind === 'success') {
                expect(result.storeId).toBe('aec6b741');
                expect(result.itemsAttempted).toBe(2);
                expect(result.itemsUpserted).toBe(2);
                expect(result.itemsFailed).toBe(0);
                expect(result.loadersWiped).toBe(1);
            }

            // lock acquire с uuid (не '1')
            const setCall = redis.set.mock.calls[0];
            expect(setCall[0]).toBe(CATALOG_REFRESH_LOCK_KEY);
            expect(setCall[1]).toMatch(/^[0-9a-f-]+$/);
            expect(setCall[4]).toBe('NX');

            // wipe call — DELETE на старый loader
            expect(flowise.request).toHaveBeenNthCalledWith(
                2,
                expect.stringContaining('/loader/aec6b741/old-broken-s3'),
                { method: 'DELETE' },
            );

            // download payload
            expect(storage.getObjectStream).toHaveBeenCalledWith(CATALOG_PAYLOAD_KEY);

            // upsert calls — 2 items
            expect(flowise.request).toHaveBeenCalledTimes(4); // list + wipe + 2 upserts

            // первый upsert — структура body
            const firstUpsertCall = flowise.request.mock.calls[2];
            expect(firstUpsertCall[0]).toContain('/document-store/upsert/aec6b741');
            expect(firstUpsertCall[1].method).toBe('POST');
            const body = firstUpsertCall[1].body as Record<string, unknown>;
            expect(body.replaceExisting).toBe(false);
            expect(body.loader).toEqual(
                expect.objectContaining({
                    name: 'plainText',
                    config: expect.objectContaining({
                        text: 'Товар: Аквафор DWM-101S\nОписание: Обратный осмос',
                    }),
                }),
            );
            expect(body.splitter).toEqual({
                name: 'recursiveCharacterTextSplitter',
                config: {
                    chunkSize: CATALOG_SPLITTER_CHUNK_SIZE,
                    chunkOverlap: CATALOG_SPLITTER_CHUNK_OVERLAP,
                },
            });
            expect(body.vectorStore).toEqual(
                expect.objectContaining({ name: 'postgres' }),
            );
            expect(body.embedding).toEqual(
                expect.objectContaining({ name: 'openAIEmbeddings' }),
            );

            // metadata — JSON.stringify со whitelist'ом полей
            const loaderConfig = (body.loader as { config: { metadata: string } }).config;
            const metadata = JSON.parse(loaderConfig.metadata) as Record<string, unknown>;
            expect(metadata).toEqual({
                externalId: 'mu-001',
                externalSource: 'moysklad',
                externalType: 'product',
                name: 'Аквафор DWM-101S',
                description: 'Обратный осмос',
                salePriceKopecks: 4500000,
                categoryPath: 'Фильтры/Обратный осмос',
                rangForApp: 5,
                imageUrls: ['catalogs/aquaphor/images/mu-001/sha1.jpg'],
            });

            // release через Lua-CAS с тем же uuid
            expect(redis.eval).toHaveBeenCalledWith(
                CATALOG_REFRESH_LOCK_RELEASE_LUA,
                1,
                CATALOG_REFRESH_LOCK_KEY,
                setCall[1],
            );
        });

        it('пустой items список → success itemsAttempted=0', async () => {
            redis.set.mockResolvedValueOnce('OK');
            flowise.request
                .mockResolvedValueOnce([SAMPLE_STORE])
                .mockResolvedValueOnce({ success: true }); // wipe
            storage.getObjectStream.mockResolvedValueOnce({
                key: CATALOG_PAYLOAD_KEY,
                body: readableFrom(JSON.stringify({ ...SAMPLE_PAYLOAD, items: [] })),
                contentType: 'application/json',
            });

            const result = await service.refresh();

            expect(result.kind).toBe('success');
            if (result.kind === 'success') {
                expect(result.itemsAttempted).toBe(0);
                expect(result.itemsUpserted).toBe(0);
                expect(result.loadersWiped).toBe(1);
            }
        });
    });

    describe('lock-held', () => {
        it('Redis SET NX вернул null → skipped, ничего больше не дёргаем', async () => {
            redis.set.mockResolvedValueOnce(null);

            const result = await service.refresh();

            expect(result.kind).toBe('skipped');
            if (result.kind === 'skipped') {
                expect(result.reason).toBe('lock-held');
            }
            expect(flowise.request).not.toHaveBeenCalled();
            expect(storage.getObjectStream).not.toHaveBeenCalled();
            expect(redis.eval).not.toHaveBeenCalled();
        });
    });

    describe('store-not-found', () => {
        it('Flowise вернул empty list → skipped, lock освобождён', async () => {
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

        it('GET /store упал → skipped с error message', async () => {
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

    describe('fetch-config failures', () => {
        it('store без vectorStoreConfig → failure stage=fetch-config', async () => {
            redis.set.mockResolvedValueOnce('OK');
            flowise.request.mockResolvedValueOnce([
                { ...SAMPLE_STORE, vectorStoreConfig: null },
            ]);

            const result = await service.refresh();

            expect(result.kind).toBe('failure');
            if (result.kind === 'failure') {
                expect(result.stage).toBe('fetch-config');
                expect(result.error).toContain('vectorStoreConfig');
            }
            expect(redis.eval).toHaveBeenCalled();
        });

        it('store с пустым embeddingConfig → failure', async () => {
            redis.set.mockResolvedValueOnce('OK');
            flowise.request.mockResolvedValueOnce([
                { ...SAMPLE_STORE, embeddingConfig: '{}' },
            ]);

            const result = await service.refresh();

            expect(result.kind).toBe('failure');
            if (result.kind === 'failure') {
                expect(result.stage).toBe('fetch-config');
            }
        });
    });

    describe('wipe-loaders failure', () => {
        it('DELETE loader упал → failure stage=wipe-loaders', async () => {
            redis.set.mockResolvedValueOnce('OK');
            flowise.request
                .mockResolvedValueOnce([SAMPLE_STORE])
                .mockRejectedValueOnce(new FlowiseError('Internal Server Error', 500));

            const result = await service.refresh();

            expect(result.kind).toBe('failure');
            if (result.kind === 'failure') {
                expect(result.stage).toBe('wipe-loaders');
                expect(result.error).toContain('Internal');
            }
        });
    });

    describe('wipe-vectors — TRUNCATE catalog_chunks', () => {
        it('happy path: TRUNCATE с schema prefix + RESTART IDENTITY', async () => {
            setupHappyPathMocks(flowise, redis, storage);
            flowise.request
                .mockResolvedValueOnce({ numAdded: 1 })
                .mockResolvedValueOnce({ numAdded: 1 });

            await service.refresh();

            expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
                'TRUNCATE TABLE "public"."catalog_chunks" RESTART IDENTITY',
            );
        });

        it('TRUNCATE упал → failure stage=wipe-vectors', async () => {
            redis.set.mockResolvedValueOnce('OK');
            flowise.request
                .mockResolvedValueOnce([SAMPLE_STORE])
                .mockResolvedValueOnce({ success: true });
            prisma.$executeRawUnsafe.mockRejectedValueOnce(
                new Error('relation "catalog_chunks" does not exist'),
            );

            const result = await service.refresh();

            expect(result.kind).toBe('failure');
            if (result.kind === 'failure') {
                expect(result.stage).toBe('wipe-vectors');
                expect(result.error).toContain('catalog_chunks');
            }
        });

        it('non-postgres vectorStore → failure (Pinecone/Chroma не поддержаны)', async () => {
            redis.set.mockResolvedValueOnce('OK');
            flowise.request
                .mockResolvedValueOnce([
                    { ...SAMPLE_STORE, vectorStoreConfig: '{"name":"pinecone","config":{}}' },
                ])
                .mockResolvedValueOnce({ success: true });

            const result = await service.refresh();

            expect(result.kind).toBe('failure');
            if (result.kind === 'failure') {
                expect(result.stage).toBe('wipe-vectors');
                expect(result.error).toContain('tableName');
            }
        });

        it('SQL injection (`;`/`--`/quotes) в tableName → format-whitelist reject', async () => {
            redis.set.mockResolvedValueOnce('OK');
            flowise.request
                .mockResolvedValueOnce([
                    {
                        ...SAMPLE_STORE,
                        vectorStoreConfig:
                            '{"name":"postgres","config":{"tableName":"catalog_chunks; DROP TABLE users;"}}',
                    },
                ])
                .mockResolvedValueOnce({ success: true });

            const result = await service.refresh();

            expect(result.kind).toBe('failure');
            if (result.kind === 'failure') {
                expect(result.stage).toBe('wipe-vectors');
                expect(result.error).toContain('format whitelist');
            }
            expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
        });

        it('non-allowed table name (User/accounts) → name-whitelist reject (blast radius)', async () => {
            // Format-валидный identifier, но не в ALLOWED_VECTOR_TABLES.
            // Защита от: admin меняет tableName в Flowise UI на критическую таблицу.
            redis.set.mockResolvedValueOnce('OK');
            flowise.request
                .mockResolvedValueOnce([
                    {
                        ...SAMPLE_STORE,
                        vectorStoreConfig: '{"name":"postgres","config":{"tableName":"User"}}',
                    },
                ])
                .mockResolvedValueOnce({ success: true });

            const result = await service.refresh();

            expect(result.kind).toBe('failure');
            if (result.kind === 'failure') {
                expect(result.stage).toBe('wipe-vectors');
                expect(result.error).toContain('ALLOWED_VECTOR_TABLES');
            }
            expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
        });

        it('Postgres reserved keyword (select/drop) → blocked by name whitelist', async () => {
            redis.set.mockResolvedValueOnce('OK');
            flowise.request
                .mockResolvedValueOnce([
                    {
                        ...SAMPLE_STORE,
                        vectorStoreConfig: '{"name":"postgres","config":{"tableName":"select"}}',
                    },
                ])
                .mockResolvedValueOnce({ success: true });

            const result = await service.refresh();

            expect(result.kind).toBe('failure');
            if (result.kind === 'failure') {
                expect(result.stage).toBe('wipe-vectors');
                expect(result.error).toContain('ALLOWED_VECTOR_TABLES');
            }
        });

        it('unicode/multibyte tableName → format-whitelist reject', async () => {
            redis.set.mockResolvedValueOnce('OK');
            flowise.request
                .mockResolvedValueOnce([
                    {
                        ...SAMPLE_STORE,
                        // Кириллица в имени — попытка homograph (выглядит как
                        // ASCII, но другие code points). Format whitelist
                        // (only `[A-Za-z0-9_]`) отбрасывает.
                        vectorStoreConfig: JSON.stringify({
                            name: 'postgres',
                            config: { tableName: 'catalog_сhunks' }, // 'с' — кириллица
                        }),
                    },
                ])
                .mockResolvedValueOnce({ success: true });

            const result = await service.refresh();

            expect(result.kind).toBe('failure');
            if (result.kind === 'failure') {
                expect(result.error).toContain('format whitelist');
            }
        });
    });

    describe('downloadPayload — size cap (DoS защита)', () => {
        it('payload > MAX_PAYLOAD_BYTES → failure stage=download-payload', async () => {
            redis.set.mockResolvedValueOnce('OK');
            flowise.request
                .mockResolvedValueOnce([SAMPLE_STORE])
                .mockResolvedValueOnce({ success: true });

            // Streaming chunks по 10MB, всего 200MB (выше 100MB cap).
            const big = Buffer.alloc(10 * 1024 * 1024, 'a');
            async function* hugePayload(): AsyncGenerator<Buffer> {
                for (let i = 0; i < 20; i++) {
                    yield big;
                }
            }
            storage.getObjectStream.mockResolvedValueOnce({
                key: CATALOG_PAYLOAD_KEY,
                body: Readable.from(hugePayload()),
                contentType: 'application/json',
            });

            const result = await service.refresh();

            expect(result.kind).toBe('failure');
            if (result.kind === 'failure') {
                expect(result.stage).toBe('download-payload');
                expect(result.error).toContain('exceeds CATALOG_MAX_PAYLOAD_BYTES');
            }
        });
    });

    describe('download-payload failures', () => {
        it('S3 NotFoundException → skipped reason=payload-not-found', async () => {
            redis.set.mockResolvedValueOnce('OK');
            flowise.request
                .mockResolvedValueOnce([SAMPLE_STORE])
                .mockResolvedValueOnce({ success: true });
            storage.getObjectStream.mockRejectedValueOnce(
                new NotFoundException('Object catalogs/aquaphor/latest.json not found'),
            );

            const result = await service.refresh();

            expect(result.kind).toBe('skipped');
            if (result.kind === 'skipped') {
                expect(result.reason).toBe('payload-not-found');
            }
        });

        it('S3 generic error → failure stage=download-payload', async () => {
            redis.set.mockResolvedValueOnce('OK');
            flowise.request
                .mockResolvedValueOnce([SAMPLE_STORE])
                .mockResolvedValueOnce({ success: true });
            storage.getObjectStream.mockRejectedValueOnce(new Error('S3 connection refused'));

            const result = await service.refresh();

            expect(result.kind).toBe('failure');
            if (result.kind === 'failure') {
                expect(result.stage).toBe('download-payload');
                expect(result.error).toContain('S3 connection refused');
            }
        });
    });

    describe('parse-payload failures', () => {
        it('malformed JSON → failure stage=parse-payload', async () => {
            redis.set.mockResolvedValueOnce('OK');
            flowise.request
                .mockResolvedValueOnce([SAMPLE_STORE])
                .mockResolvedValueOnce({ success: true });
            storage.getObjectStream.mockResolvedValueOnce({
                key: CATALOG_PAYLOAD_KEY,
                body: readableFrom('{ this is not JSON'),
                contentType: 'application/json',
            });

            const result = await service.refresh();

            expect(result.kind).toBe('failure');
            if (result.kind === 'failure') {
                expect(result.stage).toBe('parse-payload');
            }
        });

        it('zod validation fail (missing items) → failure stage=parse-payload', async () => {
            redis.set.mockResolvedValueOnce('OK');
            flowise.request
                .mockResolvedValueOnce([SAMPLE_STORE])
                .mockResolvedValueOnce({ success: true });
            storage.getObjectStream.mockResolvedValueOnce({
                key: CATALOG_PAYLOAD_KEY,
                body: readableFrom('{"syncMode":"full","sourceSystem":"moysklad","syncedAt":"now"}'),
                contentType: 'application/json',
            });

            const result = await service.refresh();

            expect(result.kind).toBe('failure');
            if (result.kind === 'failure') {
                expect(result.stage).toBe('parse-payload');
            }
        });
    });

    describe('per-item upsert — partial failures', () => {
        it('1 из 2 items упал → success с itemsFailed=1', async () => {
            setupHappyPathMocks(flowise, redis, storage);
            flowise.request
                .mockResolvedValueOnce({ numAdded: 1, addedDocs: [] })
                .mockRejectedValueOnce(new FlowiseError('Bad Request', 400));

            const result = await service.refresh();

            expect(result.kind).toBe('success');
            if (result.kind === 'success') {
                expect(result.itemsAttempted).toBe(2);
                expect(result.itemsUpserted).toBe(1);
                expect(result.itemsFailed).toBe(1);
            }
        });

        it('все upsert упали → success itemsUpserted=0 itemsFailed=N', async () => {
            setupHappyPathMocks(flowise, redis, storage);
            flowise.request
                .mockRejectedValueOnce(new FlowiseError('500', 500))
                .mockRejectedValueOnce(new FlowiseError('500', 500));

            const result = await service.refresh();

            // Per-item failure не валит refresh, но itemsFailed > 0
            expect(result.kind).toBe('success');
            if (result.kind === 'success') {
                expect(result.itemsUpserted).toBe(0);
                expect(result.itemsFailed).toBe(2);
            }
        });
    });

    describe('lock fencing — release через Lua CAS не снимает чужой lock', () => {
        it('каждый acquire генерирует новый uuid (fence-token)', async () => {
            redis.set.mockResolvedValue(null);
            await service.refresh();
            await service.refresh();

            const firstToken = redis.set.mock.calls[0][1];
            const secondToken = redis.set.mock.calls[1][1];
            expect(firstToken).not.toBe(secondToken);
            expect(firstToken).toMatch(/^[0-9a-f-]+$/);
            expect(secondToken).toMatch(/^[0-9a-f-]+$/);
        });

        it('release передаёт ровно тот uuid что использовал acquire', async () => {
            setupHappyPathMocks(flowise, redis, storage);
            flowise.request
                .mockResolvedValueOnce({ numAdded: 1 })
                .mockResolvedValueOnce({ numAdded: 1 });

            await service.refresh();

            const acquireToken = redis.set.mock.calls[0][1];
            const evalCall = redis.eval.mock.calls[0];
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

        it('успешный refresh → logger.log с completed + counters', async () => {
            setupHappyPathMocks(flowise, redis, storage);
            flowise.request
                .mockResolvedValueOnce({ numAdded: 1 })
                .mockResolvedValueOnce({ numAdded: 1 });

            await service.runScheduled();

            expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('completed'));
            expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('items=2/2'));
            expect(errorSpy).not.toHaveBeenCalled();
        });

        it('lock-held → logger.warn с skipped', async () => {
            redis.set.mockResolvedValueOnce(null);

            await service.runScheduled();

            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('skipped'));
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('lock-held'));
        });

        it('failure → logger.error не throw', async () => {
            redis.set.mockResolvedValueOnce('OK');
            flowise.request.mockResolvedValueOnce([
                { ...SAMPLE_STORE, vectorStoreConfig: null },
            ]);

            await expect(service.runScheduled()).resolves.toBeUndefined();
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('failed'));
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('fetch-config'));
        });
    });

    describe('TLS to vectorStoreConfig parsing — JSON-string vs object', () => {
        it('vectorStoreConfig как object (не string) → корректно extracted', async () => {
            setupHappyPathMocks(flowise, redis, storage);
            // Override mock — store с already-parsed configs (как из MCP-обёртки)
            flowise.request.mockReset();
            redis.set.mockReset();
            redis.set.mockResolvedValueOnce('OK');
            flowise.request
                .mockResolvedValueOnce([
                    {
                        ...SAMPLE_STORE,
                        vectorStoreConfig: {
                            name: 'postgres',
                            config: { host: 'h', tableName: 'catalog_chunks' },
                        },
                        embeddingConfig: { name: 'openAIEmbeddings', config: { dim: 1536 } },
                    },
                ])
                .mockResolvedValueOnce({ success: true })
                .mockResolvedValueOnce({ numAdded: 1 })
                .mockResolvedValueOnce({ numAdded: 1 });
            storage.getObjectStream.mockReset();
            storage.getObjectStream.mockResolvedValueOnce({
                key: CATALOG_PAYLOAD_KEY,
                body: readableFrom(JSON.stringify(SAMPLE_PAYLOAD)),
                contentType: 'application/json',
            });

            const result = await service.refresh();
            expect(result.kind).toBe('success');
        });
    });

    describe('onModuleDestroy — graceful shutdown', () => {
        it('без активного lock → только redis.quit()', async () => {
            await service.onModuleDestroy();
            expect(redis.eval).not.toHaveBeenCalled();
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
