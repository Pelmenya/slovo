// e2e для POST /catalog/search/image — wire через NestJS validation +
// vision predict + reuse text search.
//
// FlowiseClient + Redis + StorageService мокаются через overrideProvider —
// этот тест НЕ требует поднятых docker-сервисов.

import type { Server } from 'http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { STORAGE_BUCKET, STORAGE_S3_CLIENT, StorageService } from '@slovo/storage';
import request from 'supertest';
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

const SAMPLE_VISION_OUTPUT_TEXT = JSON.stringify({
    is_relevant: true,
    category: 'обратный осмос',
    brand: 'Аквафор',
    model_hint: 'DWM-101S',
    description_ru: 'Фильтр обратного осмоса',
    confidence: 'high',
});

// Минимальный валидный base64 для DTO check (1 byte = "A" → "QQ==").
// Реальный image не нужен — Flowise мокается.
const SAMPLE_BASE64 = 'QQ==';

type TFlowiseMock = { request: jest.Mock };
type TRedisMock = { get: jest.Mock; set: jest.Mock; quit: jest.Mock };
type TStorageMock = { getPresignedDownloadUrl: jest.Mock };

type TImageResponse = {
    count: number;
    timeTakenMs: number;
    docs: Array<{
        id: string;
        pageContent: string;
        metadata: Record<string, unknown>;
        imageUrls: string[];
    }>;
    visionOutput: {
        isRelevant: boolean;
        category: string | null;
        brand: string | null;
        modelHint: string | null;
        descriptionRu: string;
        confidence: string;
    };
};

describe('Catalog search/image endpoint (e2e)', () => {
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
        // Reset обоих lazy-cached chatflow/store IDs
        const imageSvc = app.get(ImageSearchService) as unknown as {
            chatflowIdPromise: Promise<string> | null;
        };
        const textSvc = app.get(TextSearchService) as unknown as {
            storeIdPromise: Promise<string> | null;
        };
        imageSvc.chatflowIdPromise = null;
        textSvc.storeIdPromise = null;
    });

    function mockHappyPath(): void {
        flowise.request
            // 1. ImageSearchService chatflow lookup
            .mockResolvedValueOnce([
                { id: TEST_CHATFLOW_ID, name: VISION_CHATFLOW_NAME },
            ])
            // 2. Vision prediction
            .mockResolvedValueOnce({ text: SAMPLE_VISION_OUTPUT_TEXT })
            // 3. TextSearchService store lookup
            .mockResolvedValueOnce([
                { id: TEST_STORE_ID, name: CATALOG_AQUAPHOR_STORE_NAME },
            ])
            // 4. vectorstore query
            .mockResolvedValueOnce({
                timeTaken: 312,
                docs: [
                    {
                        id: 'chunk-1',
                        pageContent: 'Аквафор DWM-101S',
                        metadata: {
                            externalId: 'mu-1',
                            name: 'Аквафор DWM-101S',
                            imageUrls: ['catalogs/aquaphor/images/abc/sha111.jpg'],
                        },
                        chunkNo: 1,
                    },
                ],
            });
    }

    describe('POST /catalog/search/image — happy path', () => {
        it('возвращает 200 с docs + visionOutput', async () => {
            mockHappyPath();

            const response = await request(server)
                .post('/catalog/search/image')
                .send({ imageBase64: SAMPLE_BASE64, mime: 'image/jpeg', topK: 3 })
                .expect(200);

            const body = response.body as TImageResponse;
            expect(body.count).toBe(1);
            expect(body.docs[0].id).toBe('chunk-1');
            expect(body.docs[0].imageUrls).toEqual([
                'https://signed/catalogs/aquaphor/images/abc/sha111.jpg',
            ]);
            expect(body.visionOutput).toEqual({
                isRelevant: true,
                category: 'обратный осмос',
                brand: 'Аквафор',
                modelHint: 'DWM-101S',
                descriptionRu: 'Фильтр обратного осмоса',
                confidence: 'high',
            });
        });

        it('topK не передан — текстовый search использует default', async () => {
            mockHappyPath();

            await request(server)
                .post('/catalog/search/image')
                .send({ imageBase64: SAMPLE_BASE64, mime: 'image/png' })
                .expect(200);

            // 4-й вызов — vectorstore query, должен иметь default topK=10
            expect(flowise.request).toHaveBeenLastCalledWith(
                expect.stringContaining('/document-store/vectorstore/query'),
                expect.objectContaining({
                    body: expect.objectContaining({ topK: 10 }),
                }),
            );
        });
    });

    describe('POST /catalog/search/image — vision не распознал оборудование', () => {
        it('is_relevant=false → 400 с visionOutput hint', async () => {
            flowise.request
                .mockResolvedValueOnce([
                    { id: TEST_CHATFLOW_ID, name: VISION_CHATFLOW_NAME },
                ])
                .mockResolvedValueOnce({
                    text: JSON.stringify({
                        is_relevant: false,
                        description_ru: 'Кот на фоне дивана',
                        confidence: 'high',
                    }),
                });

            const response = await request(server)
                .post('/catalog/search/image')
                .send({ imageBase64: SAMPLE_BASE64, mime: 'image/jpeg' })
                .expect(400);

            const body = response.body as { message: string; visionOutput: { isRelevant: boolean } };
            expect(body.message).toContain('not relevant');
            expect(body.visionOutput.isRelevant).toBe(false);
        });
    });

    describe('POST /catalog/search/image — validation', () => {
        it('400 если imageBase64 отсутствует', async () => {
            await request(server)
                .post('/catalog/search/image')
                .send({ mime: 'image/jpeg' })
                .expect(400);
        });

        it('400 если imageBase64 не base64', async () => {
            await request(server)
                .post('/catalog/search/image')
                .send({ imageBase64: 'not-base64-!@#$', mime: 'image/jpeg' })
                .expect(400);
        });

        it('400 если mime не в whitelist (image/svg+xml)', async () => {
            await request(server)
                .post('/catalog/search/image')
                .send({ imageBase64: SAMPLE_BASE64, mime: 'image/svg+xml' })
                .expect(400);
        });

        it('400 если mime не image (application/pdf)', async () => {
            await request(server)
                .post('/catalog/search/image')
                .send({ imageBase64: SAMPLE_BASE64, mime: 'application/pdf' })
                .expect(400);
        });

        it('400 если topK = 0', async () => {
            await request(server)
                .post('/catalog/search/image')
                .send({ imageBase64: SAMPLE_BASE64, mime: 'image/jpeg', topK: 0 })
                .expect(400);
        });

        it('400 если topK > 50', async () => {
            await request(server)
                .post('/catalog/search/image')
                .send({ imageBase64: SAMPLE_BASE64, mime: 'image/jpeg', topK: 51 })
                .expect(400);
        });

        it('400 если в body левые поля (forbidNonWhitelisted)', async () => {
            await request(server)
                .post('/catalog/search/image')
                .send({
                    imageBase64: SAMPLE_BASE64,
                    mime: 'image/jpeg',
                    chatflowId: 'attempt-override',
                })
                .expect(400);
        });
    });
});
