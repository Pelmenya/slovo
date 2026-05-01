// e2e для POST /catalog/search/text — проверяет полный wire через NestJS:
// ValidationPipe (whitelist + forbidNonWhitelisted), routing, JSON serialization
// response shape. Внешние зависимости (Flowise REST, Redis, S3 presigner)
// мокаются через overrideProvider — этот тест НЕ требует поднятых docker-сервисов.

import type { Server } from 'http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { STORAGE_BUCKET, STORAGE_S3_CLIENT, StorageService } from '@slovo/storage';
import request from 'supertest';
import { CatalogModule } from '../src/modules/catalog/catalog.module';
import {
    CATALOG_AQUAPHOR_STORE_ID,
    CATALOG_DEFAULT_TOP_K,
    FLOWISE_CLIENT_TOKEN,
    REDIS_CLIENT_TOKEN,
} from '../src/modules/catalog/catalog.constants';

type TFlowiseMock = { request: jest.Mock };
type TRedisMock = { get: jest.Mock; set: jest.Mock; quit: jest.Mock };
type TStorageMock = { getPresignedDownloadUrl: jest.Mock };

type TSearchResponse = {
    count: number;
    timeTakenMs: number;
    docs: Array<{
        id: string;
        pageContent: string;
        metadata: Record<string, unknown>;
        imageUrls: string[];
    }>;
};

describe('Catalog search/text endpoint (e2e)', () => {
    let app: INestApplication;
    let server: Server;
    let flowise: TFlowiseMock;
    let redis: TRedisMock;
    let storage: TStorageMock;

    beforeAll(async () => {
        flowise = { request: jest.fn() };
        redis = {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue('OK'),
            quit: jest.fn().mockResolvedValue('OK'),
        };
        storage = {
            getPresignedDownloadUrl: jest
                .fn()
                .mockImplementation((key: string) => Promise.resolve(`https://signed/${key}`)),
        };

        const moduleRef: TestingModule = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
                ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10_000 }]),
                CatalogModule,
            ],
        })
            .overrideProvider(FLOWISE_CLIENT_TOKEN)
            .useValue(flowise)
            .overrideProvider(REDIS_CLIENT_TOKEN)
            .useValue(redis)
            .overrideProvider(StorageService)
            .useValue(storage)
            // STORAGE_S3_CLIENT и STORAGE_BUCKET создаются useFactory'ями
            // в `StorageModule.forFeature()` и читают S3_REGION/S3_ACCESS_KEY
            // и т.п. через ConfigService. В этом e2e ConfigModule стартует с
            // ignoreEnvFile:true (изоляция от dev .env), поэтому override-им
            // оба токена пустыми заглушками — реальный S3Client тут не нужен,
            // StorageService сам уже замокан.
            .overrideProvider(STORAGE_S3_CLIENT)
            .useValue({})
            .overrideProvider(STORAGE_BUCKET)
            .useValue('test-bucket')
            .compile();

        app = moduleRef.createNestApplication();
        app.useGlobalPipes(
            new ValidationPipe({
                whitelist: true,
                forbidNonWhitelisted: true,
                transform: true,
                transformOptions: { enableImplicitConversion: true },
            }),
        );
        await app.init();
        server = app.getHttpServer() as Server;
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(() => {
        flowise.request.mockReset();
        redis.get.mockClear();
        redis.set.mockClear();
        storage.getPresignedDownloadUrl.mockClear();
    });

    describe('POST /catalog/search/text — happy path', () => {
        it('возвращает 200 с count, docs, timeTakenMs', async () => {
            flowise.request.mockResolvedValueOnce({
                timeTaken: 312,
                docs: [
                    {
                        id: 'chunk-1',
                        pageContent: 'Товар: Аквафор DWM-101S',
                        metadata: {
                            externalId: 'mu-1',
                            imageUrls: ['catalogs/aquaphor/images/abc/sha111.jpg'],
                        },
                        chunkNo: 1,
                    },
                ],
            });

            const response = await request(server)
                .post('/catalog/search/text')
                .send({ query: 'фильтр для жёсткой воды', topK: 5 })
                .expect(200);

            const body = response.body as TSearchResponse;
            expect(body.count).toBe(1);
            expect(body.timeTakenMs).toBe(312);
            expect(body.docs[0].id).toBe('chunk-1');
            expect(body.docs[0].imageUrls).toEqual([
                'https://signed/catalogs/aquaphor/images/abc/sha111.jpg',
            ]);
            expect(flowise.request).toHaveBeenCalledWith(
                expect.stringContaining('/document-store/vectorstore/query'),
                expect.objectContaining({
                    method: 'POST',
                    body: { storeId: CATALOG_AQUAPHOR_STORE_ID, query: 'фильтр для жёсткой воды', topK: 5 },
                }),
            );
        });

        it('topK не передан → service использует default', async () => {
            flowise.request.mockResolvedValueOnce({ timeTaken: 100, docs: [] });

            await request(server)
                .post('/catalog/search/text')
                .send({ query: 'тест' })
                .expect(200);

            expect(flowise.request).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    body: expect.objectContaining({ topK: CATALOG_DEFAULT_TOP_K }),
                }),
            );
        });
    });

    describe('POST /catalog/search/text — validation', () => {
        it('400 если query отсутствует', async () => {
            await request(server).post('/catalog/search/text').send({}).expect(400);
        });

        it('400 если query пустая строка', async () => {
            await request(server)
                .post('/catalog/search/text')
                .send({ query: '' })
                .expect(400);
        });

        it('400 если query > 500 символов', async () => {
            await request(server)
                .post('/catalog/search/text')
                .send({ query: 'a'.repeat(501) })
                .expect(400);
        });

        it('400 если topK = 0', async () => {
            await request(server)
                .post('/catalog/search/text')
                .send({ query: 'тест', topK: 0 })
                .expect(400);
        });

        it('400 если topK > 50', async () => {
            await request(server)
                .post('/catalog/search/text')
                .send({ query: 'тест', topK: 51 })
                .expect(400);
        });

        it('400 если topK не int (3.14)', async () => {
            await request(server)
                .post('/catalog/search/text')
                .send({ query: 'тест', topK: 3.14 })
                .expect(400);
        });

        it('400 если в body левые поля (forbidNonWhitelisted)', async () => {
            await request(server)
                .post('/catalog/search/text')
                .send({ query: 'тест', storeId: 'attempt-override' })
                .expect(400);
        });
    });
});
