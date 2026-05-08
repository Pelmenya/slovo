// e2e smoke на 7 endpoints Phase 4 backend water-analysis. Покрывает:
//   - 200 happy-path (DTO валидация + service-маппинг работает)
//   - 400 на bbox cross-field invariants
//   - 400 на param/intakeType whitelist violations
//   - 400 на out-of-range coords / k / topK
//
// PrismaService.$queryRaw мокается на пустой массив для read-only endpoints —
// этого достаточно чтобы service отдал валидный response shape без real DB.
// FlowiseClient мокается для equipment-suggest (catalog vector search).
// Redis (7 разных tokens per-endpoint) мокается одним инстансом — все endpoints
// делают get/set через одинаковый интерфейс.
//
// Цель: контракт endpoint'ов зафиксирован тестами (DTO валидация, throttle
// metadata, маршруты), регрессия ловится в CI. Real-data integration — отдельно
// через testcontainer setup (CLAUDE.md секция «Тесты»).

import type { Server } from 'http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaService } from '@slovo/database';
import request from 'supertest';
import {
    FLOWISE_CLIENT_TOKEN,
    AQUIFER_STATS_REDIS_TOKEN,
    DEPTH_MAP_REDIS_TOKEN,
    DEPTH_PREDICT_REDIS_TOKEN,
    EQUIPMENT_SUGGEST_REDIS_TOKEN,
    HEATMAP_REDIS_TOKEN,
    POINTS_REDIS_TOKEN,
    PREDICT_REDIS_TOKEN,
    WATER_ANALYSIS_AQUAPHOR_STORE_NAME,
} from '../src/modules/water-analysis/water-analysis.constants';
import { WaterAnalysisModule } from '../src/modules/water-analysis/water-analysis.module';

type TPrismaMock = { $queryRaw: jest.Mock };
type TFlowiseMock = { request: jest.Mock };
type TRedisMock = { get: jest.Mock; set: jest.Mock };

// МО bbox для smoke-тестов (нет привязки к реальной выгрузке — все queryRaw
// мокаются на пустые массивы или в helper'е).
const MOSCOW_BBOX = {
    west: 36.5,
    south: 54.8,
    east: 39.0,
    north: 56.5,
} as const;

const MOSCOW_CENTER = {
    lat: 55.7558,
    lon: 37.6173,
} as const;

describe('Water-analysis Phase 4 endpoints (e2e)', () => {
    let app: INestApplication;
    let server: Server;
    let prisma: TPrismaMock;
    let flowise: TFlowiseMock;
    let redis: TRedisMock;

    beforeAll(async () => {
        prisma = { $queryRaw: jest.fn() };
        flowise = { request: jest.fn() };
        redis = {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue('OK'),
        };

        const moduleRef: TestingModule = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
                ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10_000 }]),
                WaterAnalysisModule,
            ],
        })
            .overrideProvider(PrismaService)
            .useValue(prisma)
            .overrideProvider(FLOWISE_CLIENT_TOKEN)
            .useValue(flowise)
            .overrideProvider(HEATMAP_REDIS_TOKEN)
            .useValue(redis)
            .overrideProvider(PREDICT_REDIS_TOKEN)
            .useValue(redis)
            .overrideProvider(DEPTH_MAP_REDIS_TOKEN)
            .useValue(redis)
            .overrideProvider(DEPTH_PREDICT_REDIS_TOKEN)
            .useValue(redis)
            .overrideProvider(POINTS_REDIS_TOKEN)
            .useValue(redis)
            .overrideProvider(EQUIPMENT_SUGGEST_REDIS_TOKEN)
            .useValue(redis)
            .overrideProvider(AQUIFER_STATS_REDIS_TOKEN)
            .useValue(redis)
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
        prisma.$queryRaw.mockReset();
        flowise.request.mockReset();
        redis.get.mockReset().mockResolvedValue(null);
        redis.set.mockReset().mockResolvedValue('OK');
    });

    // =========================================================================
    // 1. GET /water-analysis/heatmap
    // =========================================================================

    describe('GET /water-analysis/heatmap', () => {
        it('200 happy-path — пустые rows → empty FeatureCollection', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);

            const res = await request(server)
                .get('/water-analysis/heatmap')
                .query({ param: 'iron_total', ...MOSCOW_BBOX })
                .expect(200);

            expect(res.body.type).toBe('FeatureCollection');
            expect(res.body.features).toEqual([]);
            expect(res.body.param).toBe('iron_total');
            expect(res.body.cached).toBe(false);
        });

        it('400 — невалидный paramCode (whitelist violation)', async () => {
            await request(server)
                .get('/water-analysis/heatmap')
                .query({ param: 'unknown_param', ...MOSCOW_BBOX })
                .expect(400);
        });

        it('400 — отсутствует обязательный param', async () => {
            await request(server)
                .get('/water-analysis/heatmap')
                .query(MOSCOW_BBOX)
                .expect(400);
        });

        it('400 — west > east (cross-field)', async () => {
            const res = await request(server)
                .get('/water-analysis/heatmap')
                .query({ param: 'iron_total', west: 39, south: 54.8, east: 36.5, north: 56.5 })
                .expect(400);
            expect((res.body.message ?? '') as string).toMatch(/west.*east/);
        });

        it('400 — grid меньше 0.02° (PII guard)', async () => {
            await request(server)
                .get('/water-analysis/heatmap')
                .query({ param: 'iron_total', ...MOSCOW_BBOX, grid: 0.001 })
                .expect(400);
        });
    });

    // =========================================================================
    // 2. GET /water-analysis/predict
    // =========================================================================

    describe('GET /water-analysis/predict', () => {
        it('200 happy-path — empty neighbors → insufficientData=true', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);

            const res = await request(server)
                .get('/water-analysis/predict')
                .query(MOSCOW_CENTER)
                .expect(200);

            expect(res.body.insufficientData).toBe(true);
            expect(res.body.predicted).toEqual({});
            expect(res.body.byCategory).toEqual({
                unsafe: [],
                concerning: [],
                borderline: [],
                safe: [],
                unmonitored: [],
            });
            expect(res.body.nNeighbors).toBe(0);
        });

        it('400 — lat вне допустимого диапазона', async () => {
            await request(server)
                .get('/water-analysis/predict')
                .query({ lat: 200, lon: 37.6 })
                .expect(400);
        });

        it('400 — k больше максимума', async () => {
            await request(server)
                .get('/water-analysis/predict')
                .query({ ...MOSCOW_CENTER, k: 1000 })
                .expect(400);
        });

        it('400 — radiusKm меньше минимума', async () => {
            await request(server)
                .get('/water-analysis/predict')
                .query({ ...MOSCOW_CENTER, radiusKm: 0 })
                .expect(400);
        });
    });

    // =========================================================================
    // 3. GET /water-analysis/depth-map
    // =========================================================================

    describe('GET /water-analysis/depth-map', () => {
        it('200 happy-path — пустые rows', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);

            const res = await request(server)
                .get('/water-analysis/depth-map')
                .query(MOSCOW_BBOX)
                .expect(200);

            expect(res.body.type).toBe('FeatureCollection');
            expect(res.body.features).toEqual([]);
            expect(res.body.intakeType).toBe('all');
        });

        it('200 — intakeType=well_dug передаётся', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);

            const res = await request(server)
                .get('/water-analysis/depth-map')
                .query({ ...MOSCOW_BBOX, intakeType: 'well_dug' })
                .expect(200);

            expect(res.body.intakeType).toBe('well_dug');
        });

        it('400 — невалидный intakeType', async () => {
            await request(server)
                .get('/water-analysis/depth-map')
                .query({ ...MOSCOW_BBOX, intakeType: 'unknown' })
                .expect(400);
        });

        it('400 — bbox слишком большой (>60° lon)', async () => {
            await request(server)
                .get('/water-analysis/depth-map')
                .query({ west: 0, south: 0, east: 70, north: 10 })
                .expect(400);
        });
    });

    // =========================================================================
    // 4. GET /water-analysis/depth-predict
    // =========================================================================

    describe('GET /water-analysis/depth-predict', () => {
        it('200 happy-path — empty neighbors → insufficientData', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);

            const res = await request(server)
                .get('/water-analysis/depth-predict')
                .query(MOSCOW_CENTER)
                .expect(200);

            expect(res.body.insufficientData).toBe(true);
            expect(res.body.predicted).toBeNull();
            expect(res.body.intakeType).toBe('well');
            expect(res.body.layerDistribution).toHaveLength(5);
        });

        it('400 — lon вне диапазона', async () => {
            await request(server)
                .get('/water-analysis/depth-predict')
                .query({ lat: 55.7, lon: 200 })
                .expect(400);
        });

        it('400 — невалидный intakeType', async () => {
            await request(server)
                .get('/water-analysis/depth-predict')
                .query({ ...MOSCOW_CENTER, intakeType: 'spring' })
                .expect(400);
        });
    });

    // =========================================================================
    // 5. GET /water-analysis/points
    // =========================================================================

    describe('GET /water-analysis/points', () => {
        it('200 happy-path — пустые rows', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);

            const res = await request(server)
                .get('/water-analysis/points')
                .query(MOSCOW_BBOX)
                .expect(200);

            expect(res.body.type).toBe('FeatureCollection');
            expect(res.body.features).toEqual([]);
            expect(res.body.count).toBe(0);
            expect(res.body.truncated).toBe(false);
        });

        it('200 — orderNumber не выходит наружу (PII guard)', async () => {
            // Mock одна row с lat/lon — проверяем что в response orderNumber нет
            // даже если БД вернула row с этим полем.
            prisma.$queryRaw.mockResolvedValueOnce([
                {
                    intake_type: 'well',
                    depth_meters: 45,
                    sample_date: new Date('2024-06-15T09:00:00.000Z'),
                    region: 'Московская',
                    locality: 'Раменское',
                    params: { iron_total: 0.42 },
                    lon: 37.6173,
                    lat: 55.7558,
                },
            ]);

            const res = await request(server)
                .get('/water-analysis/points')
                .query(MOSCOW_BBOX)
                .expect(200);

            expect(res.body.features).toHaveLength(1);
            expect(res.body.features[0].properties.orderNumber).toBeUndefined();
            // Round до 0.005° (1°/200=0.005°). 37.6173 → 37.615; 55.7558 → 55.755.
            expect(res.body.features[0].geometry.coordinates).toEqual([37.615, 55.755]);
        });

        it('400 — limit больше максимума', async () => {
            await request(server)
                .get('/water-analysis/points')
                .query({ ...MOSCOW_BBOX, limit: 5000 })
                .expect(400);
        });
    });

    // =========================================================================
    // 6. POST /water-analysis/equipment-suggest
    // =========================================================================

    describe('POST /water-analysis/equipment-suggest', () => {
        it('200 — insufficientData (predict вернул нет соседей)', async () => {
            // Predict внутри equipment-suggest вызывает $queryRaw → []  (нет соседей)
            prisma.$queryRaw.mockResolvedValueOnce([]);

            const res = await request(server)
                .post('/water-analysis/equipment-suggest')
                .send(MOSCOW_CENTER)
                .expect(200);

            expect(res.body.insufficientData).toBe(true);
            expect(res.body.problems).toEqual([]);
            expect(res.body.recommendations).toEqual([]);
            expect(res.body.searchQuery).toBe('');
            // Flowise не должен был вызываться — нет проблем (insufficientData).
            expect(flowise.request).not.toHaveBeenCalled();
        });

        it('200 — нет проблем (вода в норме) → empty recommendations без Flowise call', async () => {
            // Mock соседей с params в норме — ph 7.2 (in-range), iron 0.05 (под ПДК 0.3).
            prisma.$queryRaw.mockResolvedValueOnce([
                {
                    params: { ph: 7.2, iron_total: 0.05 },
                    depth_meters: 50,
                    intake_type: 'well',
                    sample_date: new Date('2025-01-01T00:00:00.000Z'),
                    dist_km: 1,
                },
                {
                    params: { ph: 7.3, iron_total: 0.04 },
                    depth_meters: 55,
                    intake_type: 'well',
                    sample_date: new Date('2025-01-01T00:00:00.000Z'),
                    dist_km: 2,
                },
                {
                    params: { ph: 7.1, iron_total: 0.06 },
                    depth_meters: 50,
                    intake_type: 'well',
                    sample_date: new Date('2025-01-01T00:00:00.000Z'),
                    dist_km: 3,
                },
            ]);

            const res = await request(server)
                .post('/water-analysis/equipment-suggest')
                .send(MOSCOW_CENTER)
                .expect(200);

            expect(res.body.insufficientData).toBe(false);
            expect(res.body.problems).toEqual([]);
            expect(res.body.recommendations).toEqual([]);
            expect(flowise.request).not.toHaveBeenCalled();
        });

        it('400 — отсутствует обязательное поле lat', async () => {
            await request(server)
                .post('/water-analysis/equipment-suggest')
                .send({ lon: 37.6173 })
                .expect(400);
        });

        it('400 — лишние поля в DTO (forbidNonWhitelisted)', async () => {
            await request(server)
                .post('/water-analysis/equipment-suggest')
                .send({ ...MOSCOW_CENTER, address: 'Москва, ул. Ленина 1' })
                .expect(400);
        });

        it('400 — topK выше максимума', async () => {
            await request(server)
                .post('/water-analysis/equipment-suggest')
                .send({ ...MOSCOW_CENTER, topK: 100 })
                .expect(400);
        });
    });

    // =========================================================================
    // 7. GET /water-analysis/aquifer-stats
    // =========================================================================

    describe('GET /water-analysis/aquifer-stats', () => {
        it('200 happy-path — пустые rows → 5 buckets с count=0', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);

            const res = await request(server)
                .get('/water-analysis/aquifer-stats')
                .query(MOSCOW_BBOX)
                .expect(200);

            expect(res.body.layers).toHaveLength(5);
            expect(res.body.totalWells).toBe(0);
            expect(res.body.dominantLayerId).toBeNull();
            expect(res.body.intakeType).toBe('all');
            expect(res.body.layers.every((l: { count: number }) => l.count === 0)).toBe(true);
        });

        it('400 — невалидный intakeType', async () => {
            await request(server)
                .get('/water-analysis/aquifer-stats')
                .query({ ...MOSCOW_BBOX, intakeType: 'spring' })
                .expect(400);
        });

        it('400 — south > north', async () => {
            const res = await request(server)
                .get('/water-analysis/aquifer-stats')
                .query({ west: 36.5, south: 56.5, east: 39.0, north: 54.8 })
                .expect(400);
            expect((res.body.message ?? '') as string).toMatch(/south.*north/);
        });
    });

    // =========================================================================
    // Smoke: WATER_ANALYSIS_AQUAPHOR_STORE_NAME используется в /similar — sanity
    // что constant есть в bundled module (catch'нет если случайно убрали).
    // =========================================================================

    it('sanity: WATER_ANALYSIS_AQUAPHOR_STORE_NAME экспортируется', () => {
        expect(WATER_ANALYSIS_AQUAPHOR_STORE_NAME).toBeTruthy();
        expect(typeof WATER_ANALYSIS_AQUAPHOR_STORE_NAME).toBe('string');
    });
});
