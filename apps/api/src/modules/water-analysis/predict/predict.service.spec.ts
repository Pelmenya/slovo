import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '@slovo/database';
import {
    PREDICT_CACHE_TTL_SECONDS,
    PREDICT_DEFAULT_K,
    PREDICT_DEFAULT_RADIUS_KM,
    PREDICT_REDIS_TOKEN,
} from '../water-analysis.constants';
import type { PredictQueryDto } from './dto/predict.request.dto';
import type { PredictResponseDto } from './dto/predict.response.dto';
import { PredictService } from './predict.service';

// =============================================================================
// PredictService unit-тесты — мокаем Prisma.$queryRaw + Redis (get/set),
// проверяем internal helpers (weightedMean / percentile / ageInYears /
// roundTo / aggregateNeighbors / mostLikelyAquiferLayer / buildCacheKey)
// через public API service.predict().
//
// Real PostgreSQL + PostGIS НЕ нужны (e2e под отдельный testcontainer setup).
// =============================================================================

type TNeighborRow = {
    params: Record<string, unknown>;
    depth_meters: number | null;
    intake_type: string;
    sample_date: Date;
    dist_km: number;
};

type TPrismaMock = {
    $queryRaw: jest.Mock;
};

type TRedisMock = {
    get: jest.Mock;
    set: jest.Mock;
};

describe('PredictService', () => {
    let service: PredictService;
    let prisma: TPrismaMock;
    let redis: TRedisMock;

    async function setupService(): Promise<void> {
        prisma = { $queryRaw: jest.fn() };
        redis = {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue('OK'),
        };
        const moduleRef: TestingModule = await Test.createTestingModule({
            providers: [
                PredictService,
                { provide: PrismaService, useValue: prisma },
                { provide: PREDICT_REDIS_TOKEN, useValue: redis },
            ],
        }).compile();
        service = moduleRef.get(PredictService);
    }

    function buildDto(overrides: Partial<PredictQueryDto> = {}): PredictQueryDto {
        return {
            lat: overrides.lat ?? 55.7558,
            lon: overrides.lon ?? 37.6173,
            k: overrides.k,
            radiusKm: overrides.radiusKm,
        } as PredictQueryDto;
    }

    function buildRow(overrides: Partial<TNeighborRow> = {}): TNeighborRow {
        return {
            params: overrides.params ?? { iron_total: 0.3 },
            depth_meters: overrides.depth_meters ?? null,
            intake_type: overrides.intake_type ?? 'well',
            sample_date: overrides.sample_date ?? new Date('2026-01-01'),
            dist_km: overrides.dist_km ?? 1,
        };
    }

    beforeEach(async () => {
        // Замораживаем "сегодня" для детерминированных recency-весов.
        // doNotFake: setImmediate/queueMicrotask нужны чтобы tryCacheSet
        // (fire-and-forget Promise) успел выполниться через `await new Promise(setImmediate)`.
        jest.useFakeTimers({ doNotFake: ['setImmediate', 'queueMicrotask', 'nextTick'] });
        jest.setSystemTime(new Date('2026-05-08T00:00:00.000Z'));
        await setupService();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    // -----------------------------------------------------------------------
    // kNN aggregation: distance & recency weighting
    // -----------------------------------------------------------------------

    describe('kNN aggregation — distance weighting', () => {
        it('ближайшие соседи имеют больший вклад (predicted ближе к value ближайшего)', async () => {
            // Same sample_date — recency=1 для обоих → отличие только в distance.
            // Closest dist=0.5 (weight≈0.952), far dist=50 (weight≈0.167).
            // Mean = (10*0.952 + 0*0.167)/(0.952+0.167) ≈ 8.51 → round 4 знака.
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({
                    params: { iron_total: 10 },
                    dist_km: 0.5,
                    sample_date: new Date('2026-05-01'),
                }),
                buildRow({
                    params: { iron_total: 0 },
                    dist_km: 50,
                    sample_date: new Date('2026-05-01'),
                }),
            ]);

            const res = await service.predict(buildDto());
            const iron = res.predicted.iron_total;

            expect(iron).toBeDefined();
            // Ожидаем заметный bias к ближайшему: > 7 (середина была бы 5).
            expect(iron.value).toBeGreaterThan(7);
            expect(iron.value).toBeLessThan(10);
            expect(iron.n).toBe(2);
        });

        it('свежие анализы имеют больший вклад чем старые при равной дистанции', async () => {
            // Same dist → distWeight равны. Recent = today (recency=1),
            // old = 10 years ago (recency = exp(-2) ≈ 0.135).
            // Mean = (10*1 + 0*0.135)/(1+0.135) ≈ 8.81.
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({
                    params: { iron_total: 10 },
                    dist_km: 1,
                    sample_date: new Date('2026-05-08'), // today
                }),
                buildRow({
                    params: { iron_total: 0 },
                    dist_km: 1,
                    sample_date: new Date('2016-05-08'), // 10 years old
                }),
            ]);

            const res = await service.predict(buildDto());
            const iron = res.predicted.iron_total;

            // Без recency-веса было бы ровно 5; с recency сдвиг к 10.
            expect(iron.value).toBeGreaterThan(7);
        });

        it('weightedMean симметричен — два одинаковых соседа дают то же value', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { iron_total: 0.4 }, dist_km: 1 }),
                buildRow({ params: { iron_total: 0.4 }, dist_km: 1 }),
            ]);
            const res = await service.predict(buildDto());
            expect(res.predicted.iron_total.value).toBe(0.4);
        });
    });

    // -----------------------------------------------------------------------
    // CI percentile (P10/P90) из values
    // -----------------------------------------------------------------------

    describe('CI percentile (P10/P90)', () => {
        it('values=[0.1, 0.2, 0.3, 0.4, 0.5] → ciLow=0.14, ciHigh=0.46', async () => {
            // percentile linear-interp: P10 idx=0.4 между sorted[0]=0.1 и sorted[1]=0.2
            //   → 0.1*0.6 + 0.2*0.4 = 0.14.
            // P90 idx=3.6 между sorted[3]=0.4 и sorted[4]=0.5
            //   → 0.4*0.4 + 0.5*0.6 = 0.46.
            const sampleDate = new Date('2026-05-01');
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { iron_total: 0.1 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { iron_total: 0.2 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { iron_total: 0.3 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { iron_total: 0.4 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { iron_total: 0.5 }, dist_km: 1, sample_date: sampleDate }),
            ]);

            const res = await service.predict(buildDto());
            const iron = res.predicted.iron_total;

            expect(iron.ciLow).toBeCloseTo(0.14, 4);
            expect(iron.ciHigh).toBeCloseTo(0.46, 4);
            expect(iron.n).toBe(5);
        });

        it('одно значение → ciLow = ciHigh = value', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { iron_total: 0.42 }, dist_km: 1 }),
            ]);
            const res = await service.predict(buildDto());
            const iron = res.predicted.iron_total;
            expect(iron.value).toBe(0.42);
            expect(iron.ciLow).toBe(0.42);
            expect(iron.ciHigh).toBe(0.42);
        });
    });

    // -----------------------------------------------------------------------
    // Empty neighbors → insufficientData
    // -----------------------------------------------------------------------

    describe('empty neighbors', () => {
        it('SQL вернул [] → insufficientData=true, predicted={}, nNeighbors=0', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.predict(buildDto());

            expect(res.insufficientData).toBe(true);
            expect(res.predicted).toEqual({});
            expect(res.nNeighbors).toBe(0);
            expect(res.mostLikelyAquiferLayer).toBeUndefined();
            expect(res.medianDistKm).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // mostLikelyAquiferLayer
    // -----------------------------------------------------------------------

    describe('mostLikelyAquiferLayer', () => {
        function wellRow(depth: number, dist = 1): TNeighborRow {
            return buildRow({
                depth_meters: depth,
                intake_type: 'well',
                dist_km: dist,
            });
        }

        it('median 10м (3 wells: 5/10/15) → "0-15m / Верховодка"', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([wellRow(5), wellRow(10), wellRow(15, 2)]);
            const res = await service.predict(buildDto());
            // median percentile из [5,10,15] на idx=1 → 10. 10 < 15 → Верховодка.
            expect(res.mostLikelyAquiferLayer).toBe('0-15m / Верховодка');
        });

        it('median ~30м (15-50м диапазон) → "15-50m / Песчаный"', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([wellRow(20), wellRow(30), wellRow(40)]);
            const res = await service.predict(buildDto());
            expect(res.mostLikelyAquiferLayer).toBe('15-50m / Песчаный');
        });

        it('median ~75м → "50-100m / Песчано-известняковый"', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([wellRow(60), wellRow(75), wellRow(90)]);
            const res = await service.predict(buildDto());
            expect(res.mostLikelyAquiferLayer).toBe('50-100m / Песчано-известняковый');
        });

        it('median ~150м → "100-200m / Известняковый"', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([wellRow(120), wellRow(150), wellRow(180)]);
            const res = await service.predict(buildDto());
            expect(res.mostLikelyAquiferLayer).toBe('100-200m / Известняковый');
        });

        it('median 250м → "200m+ / Артезианский"', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([wellRow(230), wellRow(250), wellRow(270)]);
            const res = await service.predict(buildDto());
            expect(res.mostLikelyAquiferLayer).toBe('200m+ / Артезианский');
        });

        it('< 3 wells с depth → undefined (порог AQUIFER_MIN_NEIGHBORS=3)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([wellRow(50), wellRow(60)]);
            const res = await service.predict(buildDto());
            expect(res.mostLikelyAquiferLayer).toBeUndefined();
        });

        it('intake_type=municipal/spring не учитываются в aquifer median', async () => {
            // 2 well + 1 municipal+1 spring → wells=2, < 3 → undefined.
            prisma.$queryRaw.mockResolvedValueOnce([
                wellRow(50),
                wellRow(60, 2),
                buildRow({ depth_meters: 100, intake_type: 'municipal', dist_km: 3 }),
                buildRow({ depth_meters: 200, intake_type: 'spring', dist_km: 4 }),
            ]);
            const res = await service.predict(buildDto());
            expect(res.mostLikelyAquiferLayer).toBeUndefined();
        });

        it('well_dug учитывается наравне с well', async () => {
            // 3 well_dug → должно быть достаточно для aquifer.
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ depth_meters: 5, intake_type: 'well_dug', dist_km: 1 }),
                buildRow({ depth_meters: 8, intake_type: 'well_dug', dist_km: 2 }),
                buildRow({ depth_meters: 10, intake_type: 'well_dug', dist_km: 3 }),
            ]);
            const res = await service.predict(buildDto());
            expect(res.mostLikelyAquiferLayer).toBe('0-15m / Верховодка');
        });

        it('well с depth_meters=null НЕ учитывается (фильтр Number.isFinite)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ depth_meters: null, intake_type: 'well', dist_km: 1 }),
                buildRow({ depth_meters: null, intake_type: 'well', dist_km: 2 }),
                buildRow({ depth_meters: null, intake_type: 'well', dist_km: 3 }),
            ]);
            const res = await service.predict(buildDto());
            expect(res.mostLikelyAquiferLayer).toBeUndefined();
        });
    });

    // -----------------------------------------------------------------------
    // exceedsPdk флаг
    // -----------------------------------------------------------------------

    describe('exceedsPdk флаг', () => {
        it('iron_total с predicted=0.5 (>0.3 ПДК) → exceedsPdk=true', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { iron_total: 0.5 }, dist_km: 1 }),
            ]);
            const res = await service.predict(buildDto());
            expect(res.predicted.iron_total.exceedsPdk).toBe(true);
        });

        it('iron_total с predicted=0.1 (<0.3 ПДК) → exceedsPdk=false', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { iron_total: 0.1 }, dist_km: 1 }),
            ]);
            const res = await service.predict(buildDto());
            expect(res.predicted.iron_total.exceedsPdk).toBe(false);
        });

        it('temperature (без ПДК) → exceedsPdk=null', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { temperature: 12 }, dist_km: 1 }),
            ]);
            const res = await service.predict(buildDto());
            expect(res.predicted.temperature.exceedsPdk).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // Cache hit / miss / errors
    // -----------------------------------------------------------------------

    describe('cache behaviour', () => {
        it('cache hit: redis.get → valid JSON → response.cached=true, нет SQL', async () => {
            const cached: PredictResponseDto = {
                predicted: {
                    iron_total: { value: 0.42, ciLow: 0.18, ciHigh: 0.72, n: 18, exceedsPdk: true },
                },
                nNeighbors: 18,
                medianDistKm: 1.5,
                radiusKm: 50,
                insufficientData: false,
                timeTakenMs: 47,
                cached: false,
            };
            redis.get.mockResolvedValueOnce(JSON.stringify(cached));

            const res = await service.predict(buildDto());

            expect(res.cached).toBe(true);
            expect(res.nNeighbors).toBe(18);
            expect(res.predicted.iron_total.value).toBe(0.42);
            expect(prisma.$queryRaw).not.toHaveBeenCalled();
        });

        it('cache miss: SQL вызывается + redis.set с TTL = PREDICT_CACHE_TTL_SECONDS (300)', async () => {
            redis.get.mockResolvedValueOnce(null);
            prisma.$queryRaw.mockResolvedValueOnce([buildRow()]);

            await service.predict(buildDto());
            // Дать tryCacheSet шанс выполниться (он fire-and-forget).
            await new Promise((r) => setImmediate(r));

            expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
            expect(redis.set).toHaveBeenCalledTimes(1);
            const [key, value, mode, ttl] = redis.set.mock.calls[0] as [
                string,
                string,
                string,
                number,
            ];
            expect(key).toMatch(/^predict:/);
            expect(typeof value).toBe('string');
            expect(mode).toBe('EX');
            expect(ttl).toBe(PREDICT_CACHE_TTL_SECONDS);
        });

        it('Redis GET error → fall through to SQL без падения', async () => {
            redis.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
            prisma.$queryRaw.mockResolvedValueOnce([buildRow()]);

            const res = await service.predict(buildDto());

            expect(res.cached).toBe(false);
            expect(res.nNeighbors).toBe(1);
            expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
        });

        it('Redis GET вернул битый JSON → fall through to SQL', async () => {
            redis.get.mockResolvedValueOnce('not-valid-json{{{');
            prisma.$queryRaw.mockResolvedValueOnce([]);

            const res = await service.predict(buildDto());

            expect(res.cached).toBe(false);
            expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
        });

        it('Redis SET error → response отдаётся, не падаем (fail-soft)', async () => {
            redis.get.mockResolvedValueOnce(null);
            redis.set.mockRejectedValueOnce(new Error('ECONNREFUSED'));
            prisma.$queryRaw.mockResolvedValueOnce([buildRow()]);

            const res = await service.predict(buildDto());
            await new Promise((r) => setImmediate(r));

            expect(res.cached).toBe(false);
            expect(res.nNeighbors).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // buildCacheKey — стабильный + округление до 0.001°
    // -----------------------------------------------------------------------

    describe('cache key', () => {
        it('одинаковые координаты → одинаковый cache-key', async () => {
            prisma.$queryRaw.mockResolvedValue([]);
            await service.predict(buildDto({ lat: 55.7558, lon: 37.6173 }));
            await service.predict(buildDto({ lat: 55.7558, lon: 37.6173 }));
            const keys = redis.get.mock.calls.map((c) => c[0] as string);
            expect(keys[0]).toBe(keys[1]);
        });

        it('координаты различающиеся менее чем на 0.001° → одинаковый cache-key', async () => {
            // toFixed(3): 55.123456 → "55.123"; 55.1234 → "55.123". Совпадают.
            prisma.$queryRaw.mockResolvedValue([]);
            await service.predict(buildDto({ lat: 55.123456, lon: 37.654321 }));
            await service.predict(buildDto({ lat: 55.1234, lon: 37.6543 }));
            const keys = redis.get.mock.calls.map((c) => c[0] as string);
            expect(keys[0]).toBe(keys[1]);
        });

        it('cache-key включает k и radiusKm — разные параметры → разные ключи', async () => {
            prisma.$queryRaw.mockResolvedValue([]);
            await service.predict(buildDto({ k: 20, radiusKm: 50 }));
            await service.predict(buildDto({ k: 50, radiusKm: 50 }));
            await service.predict(buildDto({ k: 20, radiusKm: 100 }));
            const keys = redis.get.mock.calls.map((c) => c[0] as string);
            expect(new Set(keys).size).toBe(3);
        });

        it('формат ключа: predict:<lat>:<lon>:<k>:<radiusKm>', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            await service.predict(buildDto({ lat: 55.7558, lon: 37.6173, k: 20, radiusKm: 50 }));
            expect(redis.get).toHaveBeenCalledWith('predict:55.756:37.617:20:50.000');
        });
    });

    // -----------------------------------------------------------------------
    // Default values when k / radiusKm omitted
    // -----------------------------------------------------------------------

    describe('default values', () => {
        it('k undefined → response radiusKm с PREDICT_DEFAULT_RADIUS_KM (50)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.predict(buildDto({ k: undefined, radiusKm: undefined }));
            expect(res.radiusKm).toBe(PREDICT_DEFAULT_RADIUS_KM);
        });

        it('cache key содержит DEFAULT_K (20) при k undefined', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            await service.predict(buildDto({ k: undefined, radiusKm: undefined }));
            // Ожидаем что в ключе фигурирует :20: (PREDICT_DEFAULT_K).
            const key = redis.get.mock.calls[0][0] as string;
            expect(key).toContain(`:${PREDICT_DEFAULT_K}:`);
            expect(key).toContain(PREDICT_DEFAULT_RADIUS_KM.toFixed(3));
        });
    });

    // -----------------------------------------------------------------------
    // medianDistKm calculation
    // -----------------------------------------------------------------------

    describe('medianDistKm', () => {
        it('sorted distances [0.5, 1, 1.5, 2, 2.5] → median = 1.5', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ dist_km: 0.5 }),
                buildRow({ dist_km: 1.0 }),
                buildRow({ dist_km: 1.5 }),
                buildRow({ dist_km: 2.0 }),
                buildRow({ dist_km: 2.5 }),
            ]);
            const res = await service.predict(buildDto());
            expect(res.medianDistKm).toBe(1.5);
        });

        it('два значения [1, 3] → median = 2 (linear-interp)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ dist_km: 1 }),
                buildRow({ dist_km: 3 }),
            ]);
            const res = await service.predict(buildDto());
            expect(res.medianDistKm).toBe(2);
        });

        it('округление до 2 знаков: distances [1.111, 2.222] → median = 1.67', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ dist_km: 1.111 }),
                buildRow({ dist_km: 2.222 }),
            ]);
            const res = await service.predict(buildDto());
            // (1.111+2.222)/2 = 1.6665 → 1.67 округлённо.
            expect(res.medianDistKm).toBe(1.67);
        });
    });

    // -----------------------------------------------------------------------
    // Param skipping (NaN, missing, non-numeric)
    // -----------------------------------------------------------------------

    describe('param skipping', () => {
        it('neighbor с params.iron_total=NaN → не считается в predicted.iron_total', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { iron_total: Number.NaN }, dist_km: 1 }),
                buildRow({ params: { iron_total: 0.4 }, dist_km: 2 }),
            ]);
            const res = await service.predict(buildDto());
            expect(res.predicted.iron_total.n).toBe(1);
            expect(res.predicted.iron_total.value).toBe(0.4);
        });

        it('neighbor без iron_total → не считается, predicted.iron_total отсутствует', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { manganese: 0.05 }, dist_km: 1 }),
            ]);
            const res = await service.predict(buildDto());
            expect(res.predicted.iron_total).toBeUndefined();
            expect(res.predicted.manganese).toBeDefined();
            expect(res.predicted.manganese.n).toBe(1);
        });

        it('non-numeric value (string) → пропускается', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { iron_total: '0.4' as unknown as number }, dist_km: 1 }),
                buildRow({ params: { iron_total: 0.5 }, dist_km: 2 }),
            ]);
            const res = await service.predict(buildDto());
            expect(res.predicted.iron_total.n).toBe(1);
            expect(res.predicted.iron_total.value).toBe(0.5);
        });

        it('Infinity → пропускается (Number.isFinite фильтр)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { iron_total: Number.POSITIVE_INFINITY }, dist_km: 1 }),
                buildRow({ params: { iron_total: 0.3 }, dist_km: 2 }),
            ]);
            const res = await service.predict(buildDto());
            expect(res.predicted.iron_total.n).toBe(1);
            expect(res.predicted.iron_total.value).toBe(0.3);
        });
    });

    // -----------------------------------------------------------------------
    // roundTo — 4 знака
    // -----------------------------------------------------------------------

    describe('roundTo (4 digits)', () => {
        it('predicted.value округляется до 4 знаков', async () => {
            // value=0.123456789 у одного соседа → round → 0.1235.
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { iron_total: 0.123456789 }, dist_km: 1 }),
            ]);
            const res = await service.predict(buildDto());
            expect(res.predicted.iron_total.value).toBe(0.1235);
            expect(res.predicted.iron_total.ciLow).toBe(0.1235);
            expect(res.predicted.iron_total.ciHigh).toBe(0.1235);
        });
    });

    // -----------------------------------------------------------------------
    // Response shape — все required поля
    // -----------------------------------------------------------------------

    describe('response shape', () => {
        it('содержит все required поля при пустом результате', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.predict(buildDto({ radiusKm: 25 }));

            expect(res).toEqual(
                expect.objectContaining({
                    predicted: expect.any(Object),
                    nNeighbors: expect.any(Number),
                    medianDistKm: expect.any(Number),
                    radiusKm: 25,
                    insufficientData: expect.any(Boolean),
                    timeTakenMs: expect.any(Number),
                    cached: expect.any(Boolean),
                }),
            );
            expect(res.timeTakenMs).toBeGreaterThanOrEqual(0);
        });

        it('содержит все required поля при наличии соседей', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { iron_total: 0.4, manganese: 0.05 }, dist_km: 1 }),
            ]);
            const res = await service.predict(buildDto());

            expect(res.predicted.iron_total).toEqual(
                expect.objectContaining({
                    value: expect.any(Number),
                    ciLow: expect.any(Number),
                    ciHigh: expect.any(Number),
                    n: 1,
                    exceedsPdk: expect.any(Boolean),
                }),
            );
            expect(res.predicted.manganese).toBeDefined();
            expect(res.nNeighbors).toBe(1);
            expect(res.cached).toBe(false);
            expect(res.insufficientData).toBe(false);
        });
    });
});
