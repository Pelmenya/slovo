// e2e для POST /water-analysis/similar — vector search по water-analysis-aquaphor
// Document Store через Flowise. Покрывает: happy-path / 400 (валидация) / 404 (store).

import type { Server } from 'http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import {
    FLOWISE_CLIENT_TOKEN,
    WATER_ANALYSIS_AQUAPHOR_STORE_NAME,
} from '../src/modules/water-analysis/water-analysis.constants';
import { SimilarSearchService } from '../src/modules/water-analysis/similar/similar.service';
import { WaterAnalysisModule } from '../src/modules/water-analysis/water-analysis.module';

const TEST_STORE_ID = 'wa-store-test-uuid';

type TFlowiseMock = { request: jest.Mock };

describe('Water-analysis similar search endpoint (e2e)', () => {
    let app: INestApplication;
    let server: Server;
    let flowise: TFlowiseMock;

    beforeAll(async () => {
        flowise = { request: jest.fn() };

        const moduleRef: TestingModule = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
                ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10_000 }]),
                WaterAnalysisModule,
            ],
        })
            .overrideProvider(FLOWISE_CLIENT_TOKEN)
            .useValue(flowise)
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
        // Reset storeIdPromise чтобы между тестами lookup происходил заново
        const svc = app.get(SimilarSearchService) as unknown as {
            storeIdPromise: Promise<string> | null;
        };
        svc.storeIdPromise = null;
    });

    it('200 happy-path — text + intakeType + params', async () => {
        flowise.request
            .mockResolvedValueOnce([
                { id: TEST_STORE_ID, name: WATER_ANALYSIS_AQUAPHOR_STORE_NAME },
            ])
            .mockResolvedValueOnce({
                timeTaken: 620,
                docs: [
                    {
                        id: 'chunk-1',
                        pageContent: 'Скважина 50 м.\nЖелезо общее: 1.5 мг/л.',
                        metadata: {
                            orderNumber: '14938',
                            intakeType: 'well',
                            depthMeters: 50,
                            region: 'Московская',
                            locality: 'Раменское',
                            lat: 55.6255,
                            lon: 38.1713,
                        },
                    },
                ],
            });

        const response = await request(server)
            .post('/water-analysis/similar')
            .send({
                intakeType: 'well',
                depthMeters: 50,
                params: { ph: 7.2, hardness_total: 8.2, iron_total: 1.5 },
                topK: 5,
            })
            .expect(200);

        expect(response.body).toEqual({
            count: 1,
            timeTakenMs: 620,
            blanks: [
                {
                    orderNumber: '14938',
                    intakeType: 'well',
                    depthMeters: 50,
                    region: 'Московская',
                    locality: 'Раменское',
                    // PII-mitigation: lat/lon округлены до 0.005° (~500м grid)
                    lat: 55.625,
                    lon: 38.17,
                    pageContent: 'Скважина 50 м.\nЖелезо общее: 1.5 мг/л.',
                },
            ],
        });
    });

    it('400 — невалидный intakeType', async () => {
        await request(server)
            .post('/water-analysis/similar')
            .send({
                intakeType: 'unknown_type',
                params: { ph: 7.2 },
            })
            .expect(400);
    });

    it('400 — отсутствует обязательное поле params', async () => {
        await request(server)
            .post('/water-analysis/similar')
            .send({
                intakeType: 'well',
            })
            .expect(400);
    });

    it('400 — topK выше максимума', async () => {
        await request(server)
            .post('/water-analysis/similar')
            .send({
                intakeType: 'well',
                params: { ph: 7.2 },
                topK: 1000,
            })
            .expect(400);
    });

    it('400 — depthMeters ниже допустимого', async () => {
        await request(server)
            .post('/water-analysis/similar')
            .send({
                intakeType: 'well',
                depthMeters: 0,
                params: { ph: 7.2 },
            })
            .expect(400);
    });

    it('503 — store not found в Flowise', async () => {
        flowise.request.mockResolvedValueOnce([
            { id: 'other-id', name: 'catalog-aquaphor' },
        ]);

        const response = await request(server)
            .post('/water-analysis/similar')
            .send({
                intakeType: 'well',
                params: { ph: 7.2 },
            })
            .expect(503);

        expect(response.body.message ?? '').toMatch(/Document Store .* not found/);
    });

    it('501 — geo filter not implemented', async () => {
        flowise.request.mockResolvedValueOnce([
            { id: TEST_STORE_ID, name: WATER_ANALYSIS_AQUAPHOR_STORE_NAME },
        ]);

        const response = await request(server)
            .post('/water-analysis/similar')
            .send({
                intakeType: 'well',
                params: { ph: 7.2 },
                filters: {
                    geo: { lat: 55.7558, lon: 37.6173, radiusKm: 50 },
                },
            })
            .expect(501);

        expect(response.body.message ?? '').toMatch(/not implemented/i);
    });

    it('200 — filters.matchIntakeType отсекает blanks с другим intakeType', async () => {
        flowise.request
            .mockResolvedValueOnce([
                { id: TEST_STORE_ID, name: WATER_ANALYSIS_AQUAPHOR_STORE_NAME },
            ])
            .mockResolvedValueOnce({
                timeTaken: 100,
                docs: [
                    { id: '1', pageContent: 'pc1', metadata: { orderNumber: '1', intakeType: 'well' } },
                    { id: '2', pageContent: 'pc2', metadata: { orderNumber: '2', intakeType: 'municipal' } },
                ],
            });

        const response = await request(server)
            .post('/water-analysis/similar')
            .send({
                intakeType: 'well',
                params: { ph: 7.2 },
                filters: { matchIntakeType: true },
            })
            .expect(200);

        expect(response.body.count).toBe(1);
        expect(response.body.blanks[0].orderNumber).toBe('1');
    });

    it('400 — невалидная geo lat (out of range)', async () => {
        await request(server)
            .post('/water-analysis/similar')
            .send({
                intakeType: 'well',
                params: { ph: 7.2 },
                filters: {
                    geo: { lat: 200, lon: 37.6, radiusKm: 50 },
                },
            })
            .expect(400);
    });

    it('400 — depthRange minMeters > maxMeters (cross-field invariant)', async () => {
        // class-validator не проверяет cross-field на nested DTO без custom
        // decorator. Валидация min<=max в service.validateRequest — fail-fast
        // раньше Flowise call. Сильнее silent count=0 (фронт не путается).
        const response = await request(server)
            .post('/water-analysis/similar')
            .send({
                intakeType: 'well',
                params: { ph: 7.2 },
                filters: { depthRange: { minMeters: 100, maxMeters: 50 } },
            })
            .expect(400);

        expect(response.body.message ?? '').toMatch(/обратный диапазон/);
    });

    it('400 — params пустой объект', async () => {
        await request(server)
            .post('/water-analysis/similar')
            .send({ intakeType: 'well', params: {} })
            .expect(400);
    });

    it('400 — params содержит non-finite value (string instead of number)', async () => {
        // class-validator @IsObject() пропускает Record<string, любой тип>.
        // Защита через service.validateRequest — Number.isFinite check.
        const response = await request(server)
            .post('/water-analysis/similar')
            .send({ intakeType: 'well', params: { ph: 'invalid' } })
            .expect(400);

        expect(response.body.message ?? '').toMatch(/конечным числом/);
    });

    it('forbidNonWhitelisted — лишние поля в DTO → 400', async () => {
        await request(server)
            .post('/water-analysis/similar')
            .send({
                intakeType: 'well',
                params: { ph: 7.2 },
                evilExtraField: 'sql injection attempt',
            })
            .expect(400);
    });
});
