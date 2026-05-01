import { Readable } from 'node:stream';
import { Logger, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import type { FlowiseClient } from '@slovo/flowise-client';
import { FlowiseError } from '@slovo/flowise-client';
import { StorageService } from '@slovo/storage';
import {
    CATALOG_LOADERS_REDIS_KEY,
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
    hgetall: jest.Mock;
    hset: jest.Mock;
    hdel: jest.Mock;
};
type TStorageServiceMock = { getObjectStream: jest.Mock };

const SAMPLE_STORE = {
    id: 'aec6b741',
    name: 'catalog-aquaphor',
    description: 'Каталог Аквафор',
    status: 'UPSERTED',
    loaders: [],
    whereUsed: [],
    embeddingConfig:
        '{"name":"openAIEmbeddings","config":{"modelName":"text-embedding-3-small","dimensions":1536}}',
    vectorStoreConfig:
        '{"name":"postgres","config":{"host":"slovo-postgres","port":5432,"tableName":"catalog_chunks"}}',
    recordManagerConfig:
        '{"name":"postgresRecordManager","config":{"tableName":"catalog_record_manager","cleanup":"incremental","sourceIdKey":"externalId"}}',
    totalChunks: 0,
    totalChars: 0,
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
        hgetall: jest.fn().mockResolvedValue({}),
        hset: jest.fn().mockResolvedValue(0),
        hdel: jest.fn().mockResolvedValue(0),
    };
}

function createStorageMock(): TStorageServiceMock {
    return { getObjectStream: jest.fn() };
}

// Хелпер: создать Readable из строки (JSON payload).
function readableFrom(content: string): Readable {
    return Readable.from([Buffer.from(content, 'utf-8')]);
}

// Хелпер: подготовить mock'и так, чтобы happy-path до upsert'а прошёл
// (lock acquired + store list + empty mapping + payload downloaded).
function setupHappyPathMocks(
    flowise: TFlowiseClientMock,
    redis: TRedisClientMock,
    storage: TStorageServiceMock,
): void {
    redis.set.mockResolvedValueOnce('OK');
    redis.hgetall.mockResolvedValueOnce({});
    flowise.request.mockResolvedValueOnce([SAMPLE_STORE]); // list stores
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

    beforeEach(async () => {
        flowise = createFlowiseClientMock();
        redis = createRedisMock();
        storage = createStorageMock();

        const moduleRef = await Test.createTestingModule({
            providers: [
                CatalogRefreshService,
                { provide: FLOWISE_CLIENT_TOKEN, useValue: flowise as unknown as FlowiseClient },
                { provide: REDIS_CLIENT_TOKEN, useValue: redis as unknown as Redis },
                { provide: StorageService, useValue: storage as unknown as StorageService },
            ],
        }).compile();

        service = moduleRef.get(CatalogRefreshService);
    });

    describe('happy path — first refresh (empty mapping, all upserted)', () => {
        it('lock → list → load mapping → download → parse → per-item upsert → success', async () => {
            setupHappyPathMocks(flowise, redis, storage);
            // 2 items × upsert response с returned docId
            flowise.request
                .mockResolvedValueOnce({ numAdded: 1, numSkipped: 0, docId: 'doc-mu-001' })
                .mockResolvedValueOnce({ numAdded: 1, numSkipped: 0, docId: 'doc-mu-002' });

            const result = await service.refresh();

            expect(result.kind).toBe('success');
            if (result.kind === 'success') {
                expect(result.storeId).toBe('aec6b741');
                expect(result.itemsTotal).toBe(2);
                expect(result.itemsUpserted).toBe(2);
                expect(result.itemsSkipped).toBe(0);
                expect(result.itemsFailed).toBe(0);
                expect(result.itemsRemoved).toBe(0);
            }

            // lock acquire с uuid
            const setCall = redis.set.mock.calls[0];
            expect(setCall[0]).toBe(CATALOG_REFRESH_LOCK_KEY);
            expect(setCall[1]).toMatch(/^[0-9a-f-]+$/);
            expect(setCall[4]).toBe('NX');

            // mapping загружен один раз
            expect(redis.hgetall).toHaveBeenCalledWith(CATALOG_LOADERS_REDIS_KEY);

            // download payload
            expect(storage.getObjectStream).toHaveBeenCalledWith(CATALOG_PAYLOAD_KEY);

            // upsert calls — 2 items
            expect(flowise.request).toHaveBeenCalledTimes(3); // list + 2 upserts

            // первый upsert — структура body
            const firstUpsertCall = flowise.request.mock.calls[1];
            expect(firstUpsertCall[0]).toContain('/document-store/upsert/aec6b741');
            expect(firstUpsertCall[1].method).toBe('POST');
            const body = firstUpsertCall[1].body as Record<string, unknown>;
            // empty mapping → docId не передаётся, replaceExisting=false
            expect(body.docId).toBeUndefined();
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
            expect(body.recordManager).toEqual(
                expect.objectContaining({ name: 'postgresRecordManager' }),
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

            // persist mapping — HSET с обоими новыми externalId → docId
            expect(redis.hset).toHaveBeenCalledWith(
                CATALOG_LOADERS_REDIS_KEY,
                { 'mu-001': 'doc-mu-001', 'mu-002': 'doc-mu-002' },
            );
            // ничего не удалилось — HDEL не вызван
            expect(redis.hdel).not.toHaveBeenCalled();

            // release через Lua-CAS с тем же uuid
            expect(redis.eval).toHaveBeenCalledWith(
                CATALOG_REFRESH_LOCK_RELEASE_LUA,
                1,
                CATALOG_REFRESH_LOCK_KEY,
                setCall[1],
            );
        });

        it('пустой items список → success с itemsTotal=0', async () => {
            redis.set.mockResolvedValueOnce('OK');
            redis.hgetall.mockResolvedValueOnce({});
            flowise.request.mockResolvedValueOnce([SAMPLE_STORE]);
            storage.getObjectStream.mockResolvedValueOnce({
                key: CATALOG_PAYLOAD_KEY,
                body: readableFrom(JSON.stringify({ ...SAMPLE_PAYLOAD, items: [] })),
                contentType: 'application/json',
            });

            const result = await service.refresh();

            expect(result.kind).toBe('success');
            if (result.kind === 'success') {
                expect(result.itemsTotal).toBe(0);
                expect(result.itemsUpserted).toBe(0);
                expect(result.itemsSkipped).toBe(0);
                expect(result.itemsRemoved).toBe(0);
            }
            // upsert не вызывался
            expect(flowise.request).toHaveBeenCalledTimes(1); // только list stores
        });
    });

    describe('RecordManager skip-if-unchanged — repeat refresh', () => {
        it('mapping populated + content unchanged → numSkipped=1 → itemsSkipped=2', async () => {
            redis.set.mockResolvedValueOnce('OK');
            // Mapping pre-populated с docId для каждого externalId
            redis.hgetall.mockResolvedValueOnce({
                'mu-001': 'doc-mu-001',
                'mu-002': 'doc-mu-002',
            });
            flowise.request.mockResolvedValueOnce([SAMPLE_STORE]);
            storage.getObjectStream.mockResolvedValueOnce({
                key: CATALOG_PAYLOAD_KEY,
                body: readableFrom(JSON.stringify(SAMPLE_PAYLOAD)),
                contentType: 'application/json',
            });
            // RecordManager: hash совпал → numSkipped=1, numAdded=0
            flowise.request
                .mockResolvedValueOnce({ numAdded: 0, numSkipped: 1, numUpdated: 0, docId: 'doc-mu-001' })
                .mockResolvedValueOnce({ numAdded: 0, numSkipped: 1, numUpdated: 0, docId: 'doc-mu-002' });

            const result = await service.refresh();

            expect(result.kind).toBe('success');
            if (result.kind === 'success') {
                expect(result.itemsTotal).toBe(2);
                expect(result.itemsUpserted).toBe(0);
                expect(result.itemsSkipped).toBe(2);
                expect(result.itemsFailed).toBe(0);
                expect(result.itemsRemoved).toBe(0);
            }

            // upsert body передал stored docId + replaceExisting=true
            const firstUpsertCall = flowise.request.mock.calls[1];
            const body = firstUpsertCall[1].body as Record<string, unknown>;
            expect(body.docId).toBe('doc-mu-001');
            expect(body.replaceExisting).toBe(true);

            // mapping не нужно update'ить (всё уже было) — HSET не вызван
            expect(redis.hset).not.toHaveBeenCalled();
            expect(redis.hdel).not.toHaveBeenCalled();
        });

        it('mixed: 1 skipped, 1 upserted (content changed) → корректные counters', async () => {
            redis.set.mockResolvedValueOnce('OK');
            redis.hgetall.mockResolvedValueOnce({
                'mu-001': 'doc-mu-001',
                'mu-002': 'doc-mu-002',
            });
            flowise.request.mockResolvedValueOnce([SAMPLE_STORE]);
            storage.getObjectStream.mockResolvedValueOnce({
                key: CATALOG_PAYLOAD_KEY,
                body: readableFrom(JSON.stringify(SAMPLE_PAYLOAD)),
                contentType: 'application/json',
            });
            // mu-001 — skipped, mu-002 — replaced (content changed)
            flowise.request
                .mockResolvedValueOnce({ numAdded: 0, numSkipped: 1, numUpdated: 0, docId: 'doc-mu-001' })
                .mockResolvedValueOnce({ numAdded: 1, numSkipped: 0, numUpdated: 0, docId: 'doc-mu-002' });

            const result = await service.refresh();

            expect(result.kind).toBe('success');
            if (result.kind === 'success') {
                expect(result.itemsUpserted).toBe(1);
                expect(result.itemsSkipped).toBe(1);
                expect(result.itemsFailed).toBe(0);
            }
        });
    });

    describe('REMOVED-sweep — items disappeared from payload', () => {
        it('item в mapping но не в payload → DELETE loader + HDEL', async () => {
            redis.set.mockResolvedValueOnce('OK');
            // mu-999 в mapping но НЕ в payload (был удалён в feeder)
            redis.hgetall.mockResolvedValueOnce({
                'mu-001': 'doc-mu-001',
                'mu-002': 'doc-mu-002',
                'mu-999': 'doc-mu-999',
            });
            flowise.request.mockResolvedValueOnce([SAMPLE_STORE]);
            storage.getObjectStream.mockResolvedValueOnce({
                key: CATALOG_PAYLOAD_KEY,
                body: readableFrom(JSON.stringify(SAMPLE_PAYLOAD)),
                contentType: 'application/json',
            });
            // 2 upserts (skipped) + 1 DELETE для mu-999
            flowise.request
                .mockResolvedValueOnce({ numAdded: 0, numSkipped: 1, docId: 'doc-mu-001' })
                .mockResolvedValueOnce({ numAdded: 0, numSkipped: 1, docId: 'doc-mu-002' })
                .mockResolvedValueOnce({ success: true }); // DELETE loader response

            const result = await service.refresh();

            expect(result.kind).toBe('success');
            if (result.kind === 'success') {
                expect(result.itemsRemoved).toBe(1);
                expect(result.itemsSkipped).toBe(2);
                expect(result.itemsTotal).toBe(2);
            }

            // DELETE loader вызван для mu-999
            expect(flowise.request).toHaveBeenCalledWith(
                expect.stringContaining('/loader/aec6b741/doc-mu-999'),
                { method: 'DELETE' },
            );

            // HDEL вызван для mu-999
            expect(redis.hdel).toHaveBeenCalledWith(CATALOG_LOADERS_REDIS_KEY, 'mu-999');
        });

        it('REMOVED-sweep partial failure не валит refresh', async () => {
            redis.set.mockResolvedValueOnce('OK');
            redis.hgetall.mockResolvedValueOnce({
                'mu-001': 'doc-mu-001',
                'mu-002': 'doc-mu-002',
                'mu-999': 'doc-mu-999',
            });
            flowise.request.mockResolvedValueOnce([SAMPLE_STORE]);
            storage.getObjectStream.mockResolvedValueOnce({
                key: CATALOG_PAYLOAD_KEY,
                body: readableFrom(JSON.stringify(SAMPLE_PAYLOAD)),
                contentType: 'application/json',
            });
            const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
            flowise.request
                .mockResolvedValueOnce({ numAdded: 0, numSkipped: 1, docId: 'doc-mu-001' })
                .mockResolvedValueOnce({ numAdded: 0, numSkipped: 1, docId: 'doc-mu-002' })
                .mockRejectedValueOnce(new FlowiseError('500', 500)); // DELETE упал

            const result = await service.refresh();

            // Refresh всё равно success — sweep лишь partial
            expect(result.kind).toBe('success');
            if (result.kind === 'success') {
                expect(result.itemsRemoved).toBe(0); // counter не инкрементнулся
                expect(result.itemsSkipped).toBe(2);
            }
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('removeStaleLoader failed'));
            warnSpy.mockRestore();
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
            expect(redis.hgetall).not.toHaveBeenCalled();
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
                expect(result.error).toContain('recordManagerConfig');
            }
            expect(redis.eval).toHaveBeenCalled();
        });

        it('store без recordManagerConfig → failure (PR9.5 требует RecordManager)', async () => {
            redis.set.mockResolvedValueOnce('OK');
            flowise.request.mockResolvedValueOnce([
                { ...SAMPLE_STORE, recordManagerConfig: null },
            ]);

            const result = await service.refresh();

            expect(result.kind).toBe('failure');
            if (result.kind === 'failure') {
                expect(result.stage).toBe('fetch-config');
                expect(result.error).toContain('recordManagerConfig');
            }
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

        it('vectorStore.tableName не в whitelist → failure stage=fetch-config', async () => {
            redis.set.mockResolvedValueOnce('OK');
            flowise.request.mockResolvedValueOnce([
                {
                    ...SAMPLE_STORE,
                    vectorStoreConfig:
                        '{"name":"postgres","config":{"tableName":"User"}}',
                },
            ]);

            const result = await service.refresh();

            expect(result.kind).toBe('failure');
            if (result.kind === 'failure') {
                expect(result.stage).toBe('fetch-config');
                expect(result.error).toContain('ALLOWED_VECTOR_TABLES');
            }
        });
    });

    describe('load-loader-mapping failure', () => {
        it('Redis HGETALL упал → failure stage=load-loader-mapping', async () => {
            redis.set.mockResolvedValueOnce('OK');
            flowise.request.mockResolvedValueOnce([SAMPLE_STORE]);
            redis.hgetall.mockReset();
            redis.hgetall.mockRejectedValueOnce(new Error('Redis connection lost'));

            const result = await service.refresh();

            expect(result.kind).toBe('failure');
            if (result.kind === 'failure') {
                expect(result.stage).toBe('load-loader-mapping');
                expect(result.error).toContain('Redis connection lost');
            }
            expect(redis.eval).toHaveBeenCalled();
        });
    });

    describe('downloadPayload — size cap (DoS защита)', () => {
        it('payload > MAX_PAYLOAD_BYTES → failure stage=download-payload', async () => {
            redis.set.mockResolvedValueOnce('OK');
            flowise.request.mockResolvedValueOnce([SAMPLE_STORE]);

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
            flowise.request.mockResolvedValueOnce([SAMPLE_STORE]);
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
            flowise.request.mockResolvedValueOnce([SAMPLE_STORE]);
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
            flowise.request.mockResolvedValueOnce([SAMPLE_STORE]);
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
            flowise.request.mockResolvedValueOnce([SAMPLE_STORE]);
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
                .mockResolvedValueOnce({ numAdded: 1, numSkipped: 0, docId: 'doc-mu-001' })
                .mockRejectedValueOnce(new FlowiseError('Bad Request', 400));

            const result = await service.refresh();

            expect(result.kind).toBe('success');
            if (result.kind === 'success') {
                expect(result.itemsTotal).toBe(2);
                expect(result.itemsUpserted).toBe(1);
                expect(result.itemsFailed).toBe(1);
                expect(result.itemsSkipped).toBe(0);
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

    describe('persist mapping — partial state updates', () => {
        it('новый item (без stored docId) → HSET добавляет в mapping', async () => {
            redis.set.mockResolvedValueOnce('OK');
            // mu-001 уже есть, mu-002 новый
            redis.hgetall.mockResolvedValueOnce({ 'mu-001': 'doc-mu-001' });
            flowise.request.mockResolvedValueOnce([SAMPLE_STORE]);
            storage.getObjectStream.mockResolvedValueOnce({
                key: CATALOG_PAYLOAD_KEY,
                body: readableFrom(JSON.stringify(SAMPLE_PAYLOAD)),
                contentType: 'application/json',
            });
            flowise.request
                .mockResolvedValueOnce({ numAdded: 0, numSkipped: 1, docId: 'doc-mu-001' })
                .mockResolvedValueOnce({ numAdded: 1, numSkipped: 0, docId: 'doc-mu-002' });

            await service.refresh();

            // HSET только для mu-002 (новый), mu-001 уже был
            expect(redis.hset).toHaveBeenCalledWith(
                CATALOG_LOADERS_REDIS_KEY,
                { 'mu-002': 'doc-mu-002' },
            );
        });

        it('persist failure → warn, refresh всё равно success', async () => {
            setupHappyPathMocks(flowise, redis, storage);
            flowise.request
                .mockResolvedValueOnce({ numAdded: 1, numSkipped: 0, docId: 'doc-mu-001' })
                .mockResolvedValueOnce({ numAdded: 1, numSkipped: 0, docId: 'doc-mu-002' });
            redis.hset.mockRejectedValueOnce(new Error('Redis OOM'));
            const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

            const result = await service.refresh();

            expect(result.kind).toBe('success');
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('persist loader mapping failed'));
            warnSpy.mockRestore();
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
                .mockResolvedValueOnce({ numAdded: 1, docId: 'doc-mu-001' })
                .mockResolvedValueOnce({ numAdded: 1, docId: 'doc-mu-002' });

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
                .mockResolvedValueOnce({ numAdded: 1, docId: 'doc-mu-001' })
                .mockResolvedValueOnce({ numAdded: 1, docId: 'doc-mu-002' });

            await service.runScheduled();

            expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('completed'));
            expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('total=2'));
            expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('upserted=2'));
            expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('skipped=0'));
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

    describe('vectorStoreConfig parsing — JSON-string vs object', () => {
        it('configs как object (не string) → корректно extracted', async () => {
            redis.set.mockResolvedValueOnce('OK');
            redis.hgetall.mockResolvedValueOnce({});
            flowise.request.mockResolvedValueOnce([
                {
                    ...SAMPLE_STORE,
                    vectorStoreConfig: {
                        name: 'postgres',
                        config: { host: 'h', tableName: 'catalog_chunks' },
                    },
                    embeddingConfig: { name: 'openAIEmbeddings', config: { dim: 1536 } },
                    recordManagerConfig: {
                        name: 'postgresRecordManager',
                        config: { tableName: 'catalog_record_manager' },
                    },
                },
            ]);
            storage.getObjectStream.mockResolvedValueOnce({
                key: CATALOG_PAYLOAD_KEY,
                body: readableFrom(JSON.stringify(SAMPLE_PAYLOAD)),
                contentType: 'application/json',
            });
            flowise.request
                .mockResolvedValueOnce({ numAdded: 1, docId: 'doc-mu-001' })
                .mockResolvedValueOnce({ numAdded: 1, docId: 'doc-mu-002' });

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
