// e2e для POST /catalog/search — universal endpoint, замена /text+/image из PR7+PR8.
// Покрывает: text-only / image-only / combined + 1..5 фото + validation.

import type { Server } from 'http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { STORAGE_BUCKET, STORAGE_S3_CLIENT, StorageService } from '@slovo/storage';
import request from 'supertest';
import { BUDGET_REDIS_TOKEN, BudgetModule, BudgetService } from '../src/modules/budget';
import { CatalogModule } from '../src/modules/catalog/catalog.module';
import {
    CATALOG_AQUAPHOR_STORE_NAME,
    FLOWISE_CLIENT_TOKEN,
    REDIS_CLIENT_TOKEN,
    VISION_CHATFLOW_NAME,
} from '../src/modules/catalog/catalog.constants';
import { ImageSearchService } from '../src/modules/catalog/search/image.service';
import { TextSearchService } from '../src/modules/catalog/search/text.service';

const TEST_STORE_ID = 'aec6b741-test';
const TEST_CHATFLOW_ID = 'vision-flow-test';
const SAMPLE_BASE64 = 'QQ=='; // valid base64 (1 byte = "A")

const SAMPLE_VISION_TEXT = JSON.stringify({
    is_relevant: true,
    category: 'обратный осмос',
    brand: 'Аквафор',
    model_hint: 'DWM-101S',
    description_ru: 'Фильтр обратного осмоса',
    confidence: 'high',
});

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
    visionOutput?: {
        isRelevant: boolean;
        category: string | null;
        brand: string | null;
        descriptionRu: string;
        confidence: string;
    };
};

describe('Catalog universal search endpoint (e2e)', () => {
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

        const budgetMock = {
            assertVisionBudget: jest.fn().mockResolvedValue(undefined),
            assertEmbeddingBudget: jest.fn().mockResolvedValue(undefined),
            recordVisionCall: jest.fn().mockResolvedValue(undefined),
            recordEmbeddingTokens: jest.fn().mockResolvedValue(undefined),
        };

        const moduleRef: TestingModule = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
                ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10_000 }]),
                // BudgetModule @Global() — без явного import @Global()
                // не работает в test-only setup (только AppModule имеет
                // его). Импортим явно + override Redis token + BudgetService
                // на mock — реальный ioredis в test не нужен.
                BudgetModule,
                CatalogModule,
            ],
        })
            .overrideProvider(FLOWISE_CLIENT_TOKEN)
            .useValue(flowise)
            .overrideProvider(REDIS_CLIENT_TOKEN)
            .useValue(redis)
            .overrideProvider(StorageService)
            .useValue(storage)
            .overrideProvider(STORAGE_S3_CLIENT)
            .useValue({})
            .overrideProvider(STORAGE_BUCKET)
            .useValue('test-bucket')
            .overrideProvider(BUDGET_REDIS_TOKEN)
            .useValue({})
            .overrideProvider(BudgetService)
            .useValue(budgetMock)
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
        const imageSvc = app.get(ImageSearchService) as unknown as {
            chatflowIdPromise: Promise<string> | null;
        };
        const textSvc = app.get(TextSearchService) as unknown as {
            storeIdPromise: Promise<string> | null;
        };
        imageSvc.chatflowIdPromise = null;
        textSvc.storeIdPromise = null;
    });

    function mockTextSearchOnly(): void {
        // Last calls in chain: store lookup + vector query
        flowise.request
            .mockResolvedValueOnce([{ id: TEST_STORE_ID, name: CATALOG_AQUAPHOR_STORE_NAME }])
            .mockResolvedValueOnce({
                timeTaken: 312,
                docs: [
                    {
                        id: 'chunk-1',
                        pageContent: 'Аквафор',
                        metadata: { externalId: 'mu-1', name: 'Аквафор DWM-101S' },
                        chunkNo: 1,
                    },
                ],
            });
    }

    function mockVisionPlusTextSearch(): void {
        flowise.request
            // 1. chatflow lookup
            .mockResolvedValueOnce([{ id: TEST_CHATFLOW_ID, name: VISION_CHATFLOW_NAME }])
            // 2. vision predict
            .mockResolvedValueOnce({ text: SAMPLE_VISION_TEXT })
            // 3. store lookup
            .mockResolvedValueOnce([{ id: TEST_STORE_ID, name: CATALOG_AQUAPHOR_STORE_NAME }])
            // 4. vector query
            .mockResolvedValueOnce({
                timeTaken: 312,
                docs: [
                    {
                        id: 'chunk-1',
                        pageContent: 'Аквафор',
                        metadata: {
                            externalId: 'mu-1',
                            name: 'Аквафор',
                            imageUrls: ['catalogs/aquaphor/img.jpg'],
                        },
                        chunkNo: 1,
                    },
                ],
            });
    }

    describe('text-only mode', () => {
        it('200 с docs, без visionOutput', async () => {
            mockTextSearchOnly();

            const response = await request(server)
                .post('/catalog/search')
                .send({ query: 'фильтр для жёсткой воды', topK: 5 })
                .expect(200);

            const body = response.body as TSearchResponse;
            expect(body.count).toBe(1);
            expect(body.visionOutput).toBeUndefined();
            expect(body.docs[0].imageUrls).toEqual([]); // no imageUrls in metadata
        });
    });

    describe('image-only mode', () => {
        it('1 фото → 200 с docs + visionOutput', async () => {
            mockVisionPlusTextSearch();

            const response = await request(server)
                .post('/catalog/search')
                .send({
                    images: [{ base64: SAMPLE_BASE64, mime: 'image/jpeg' }],
                    topK: 3,
                })
                .expect(200);

            const body = response.body as TSearchResponse;
            expect(body.visionOutput).toEqual(
                expect.objectContaining({
                    isRelevant: true,
                    category: 'обратный осмос',
                    brand: 'Аквафор',
                    descriptionRu: 'Фильтр обратного осмоса',
                }),
            );
        });

        it('5 фото (max) → 200, processVision вызывался 1 раз с array', async () => {
            mockVisionPlusTextSearch();

            const fiveImages = [1, 2, 3, 4, 5].map(() => ({
                base64: SAMPLE_BASE64,
                mime: 'image/jpeg',
            }));

            await request(server)
                .post('/catalog/search')
                .send({ images: fiveImages })
                .expect(200);

            // 4 общих flowise calls (chatflow + vision + store + query)
            expect(flowise.request).toHaveBeenCalledTimes(4);
        });

        it('vision is_relevant=false → 400 с visionOutput hint', async () => {
            flowise.request
                .mockResolvedValueOnce([{ id: TEST_CHATFLOW_ID, name: VISION_CHATFLOW_NAME }])
                .mockResolvedValueOnce({
                    text: JSON.stringify({
                        is_relevant: false,
                        description_ru: 'Кот',
                        confidence: 'high',
                    }),
                });

            const response = await request(server)
                .post('/catalog/search')
                .send({ images: [{ base64: SAMPLE_BASE64, mime: 'image/jpeg' }] })
                .expect(400);

            const body = response.body as { message: string; visionOutput: { isRelevant: boolean } };
            expect(body.message).toContain('not relevant');
            expect(body.visionOutput.isRelevant).toBe(false);
        });
    });

    describe('combined mode (query + images)', () => {
        it('query + 1 фото → 200, downstream search получает combined query', async () => {
            mockVisionPlusTextSearch();

            await request(server)
                .post('/catalog/search')
                .send({
                    query: 'для дома',
                    images: [{ base64: SAMPLE_BASE64, mime: 'image/jpeg' }],
                })
                .expect(200);

            // 4-й вызов — vectorstore query, body.query = "для дома Фильтр обратного осмоса"
            const lastCall = flowise.request.mock.calls[3];
            expect(lastCall[0]).toContain('/document-store/vectorstore/query');
            expect(lastCall[1].body.query).toBe('для дома Фильтр обратного осмоса');
        });
    });

    describe('validation — at-least-one (query OR images)', () => {
        it('пустой body {} → 400', async () => {
            await request(server).post('/catalog/search').send({}).expect(400);
        });

        it('только topK, без query/images → 400', async () => {
            await request(server)
                .post('/catalog/search')
                .send({ topK: 5 })
                .expect(400);
        });

        it('images: [] (пустой массив) → 400 (ArrayMinSize)', async () => {
            await request(server)
                .post('/catalog/search')
                .send({ images: [] })
                .expect(400);
        });
    });

    describe('validation — query', () => {
        it('400 если query пустая строка', async () => {
            await request(server)
                .post('/catalog/search')
                .send({ query: '' })
                .expect(400);
        });

        it('400 если query > 500 chars', async () => {
            await request(server)
                .post('/catalog/search')
                .send({ query: 'a'.repeat(501) })
                .expect(400);
        });
    });

    describe('validation — images', () => {
        it('400 если images > 5 (ArrayMaxSize)', async () => {
            const sixImages = [1, 2, 3, 4, 5, 6].map(() => ({
                base64: SAMPLE_BASE64,
                mime: 'image/jpeg',
            }));
            await request(server)
                .post('/catalog/search')
                .send({ images: sixImages })
                .expect(400);
        });

        it('400 если image без mime', async () => {
            await request(server)
                .post('/catalog/search')
                .send({ images: [{ base64: SAMPLE_BASE64 }] })
                .expect(400);
        });

        it('400 если mime не в whitelist (image/svg+xml)', async () => {
            await request(server)
                .post('/catalog/search')
                .send({ images: [{ base64: SAMPLE_BASE64, mime: 'image/svg+xml' }] })
                .expect(400);
        });

        it('400 если base64 невалидный', async () => {
            await request(server)
                .post('/catalog/search')
                .send({ images: [{ base64: 'not-base64!@#', mime: 'image/jpeg' }] })
                .expect(400);
        });
    });

    describe('validation — topK', () => {
        it('400 если topK = 0', async () => {
            await request(server)
                .post('/catalog/search')
                .send({ query: 'тест', topK: 0 })
                .expect(400);
        });

        it('400 если topK > 50', async () => {
            await request(server)
                .post('/catalog/search')
                .send({ query: 'тест', topK: 51 })
                .expect(400);
        });
    });

    describe('validation — non-whitelisted body fields', () => {
        it('400 если в body левые поля (forbidNonWhitelisted)', async () => {
            await request(server)
                .post('/catalog/search')
                .send({ query: 'тест', storeId: 'attempt-override' })
                .expect(400);
        });
    });
});
