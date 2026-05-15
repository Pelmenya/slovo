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
// PredictService unit-тесты — interval-first философия (3 уровня intervals
// + pointEstimate + interval-aware pdkStatus). Мокаем Prisma.$queryRaw + Redis,
// проверяем internal helpers (weightedMean / percentile / ageInYears /
// roundTo / aggregateNeighbors / mostLikelyAquiferLayer / buildCacheKey
// / evaluatePdkStatus) через public API service.predict().
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
    // kNN aggregation: distance & recency weighting (pointEstimate)
    // -----------------------------------------------------------------------

    describe('kNN aggregation — distance weighting (pointEstimate)', () => {
        it('ближайшие соседи имеют больший вклад (pointEstimate ближе к value ближайшего)', async () => {
            // Same sample_date — recency=1 для обоих → отличие только в distance.
            // Closest dist=0.5 (weight≈0.952), far dist=50 (weight≈0.167).
            // Mean = (10*0.952 + 0*0.167)/(0.952+0.167) ≈ 8.51.
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
            expect(iron.pointEstimate).toBeGreaterThan(7);
            expect(iron.pointEstimate).toBeLessThan(10);
            expect(iron.n).toBe(2);
        });

        it('свежие анализы имеют больший вклад чем старые при равной дистанции', async () => {
            // Same dist → distWeight равны. Recent = today (recency=1),
            // old = 10 years ago (recency = exp(-2) ≈ 0.135).
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
            expect(iron.pointEstimate).toBeGreaterThan(7);
        });

        it('weightedMean симметричен — два одинаковых соседа дают тот же pointEstimate', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { iron_total: 0.4 }, dist_km: 1 }),
                buildRow({ params: { iron_total: 0.4 }, dist_km: 1 }),
            ]);
            const res = await service.predict(buildDto());
            expect(res.predicted.iron_total.pointEstimate).toBe(0.4);
        });
    });

    // -----------------------------------------------------------------------
    // 3 уровня intervals (interval=P10..P90, iqr=P25..P75, hardRange=min..max)
    // -----------------------------------------------------------------------

    describe('intervals (P10/P25/P75/P90 + hardRange)', () => {
        it('values=[0.1, 0.2, 0.3, 0.4, 0.5] → interval=[0.14,0.46], iqr=[0.2,0.4], hardRange=[0.1,0.5]', async () => {
            // percentile linear-interp:
            //   P10 idx=0.4 между sorted[0]=0.1 и sorted[1]=0.2 → 0.1*0.6+0.2*0.4 = 0.14
            //   P25 idx=1.0 → sorted[1] = 0.2
            //   P75 idx=3.0 → sorted[3] = 0.4
            //   P90 idx=3.6 между sorted[3]=0.4 и sorted[4]=0.5 → 0.4*0.4+0.5*0.6 = 0.46
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

            expect(iron.interval.lower).toBeCloseTo(0.14, 4);
            expect(iron.interval.upper).toBeCloseTo(0.46, 4);
            expect(iron.interval.confidence).toBe(80);

            expect(iron.iqr.lower).toBeCloseTo(0.2, 4);
            expect(iron.iqr.upper).toBeCloseTo(0.4, 4);
            expect(iron.iqr.confidence).toBe(50);

            expect(iron.hardRange.lower).toBe(0.1);
            expect(iron.hardRange.upper).toBe(0.5);
            expect(iron.hardRange.confidence).toBe(100);

            expect(iron.n).toBe(5);
        });

        it('одно значение → все 3 интервала схлопываются в [value, value]', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { iron_total: 0.42 }, dist_km: 1 }),
            ]);
            const res = await service.predict(buildDto());
            const iron = res.predicted.iron_total;
            expect(iron.pointEstimate).toBe(0.42);
            expect(iron.interval.lower).toBe(0.42);
            expect(iron.interval.upper).toBe(0.42);
            expect(iron.iqr.lower).toBe(0.42);
            expect(iron.iqr.upper).toBe(0.42);
            expect(iron.hardRange.lower).toBe(0.42);
            expect(iron.hardRange.upper).toBe(0.42);
        });

        it('hardRange всегда содержит min/max sorted (даже когда interval уже)', async () => {
            // Outliers попадают в hardRange но не в interval/iqr.
            const sampleDate = new Date('2026-05-01');
            const values = [0.05, 0.2, 0.25, 0.3, 0.35, 0.4, 1.5];
            prisma.$queryRaw.mockResolvedValueOnce(
                values.map((v) =>
                    buildRow({ params: { iron_total: v }, dist_km: 1, sample_date: sampleDate }),
                ),
            );
            const res = await service.predict(buildDto());
            const iron = res.predicted.iron_total;
            expect(iron.hardRange.lower).toBe(0.05);
            expect(iron.hardRange.upper).toBe(1.5);
            // interval ≠ hardRange (outliers исключены)
            expect(iron.interval.lower).toBeGreaterThan(0.05);
            expect(iron.interval.upper).toBeLessThan(1.5);
            // iqr ⊆ interval
            expect(iron.iqr.lower).toBeGreaterThanOrEqual(iron.interval.lower);
            expect(iron.iqr.upper).toBeLessThanOrEqual(iron.interval.upper);
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
        // Все happy-path сценарии — 5 wells (порог AQUIFER_MIN_NEIGHBORS=5,
        // поднят с 3 в security-fix 2026-05-08 для PII hardening kNN).
        function wellRow(depth: number, dist = 1): TNeighborRow {
            return buildRow({
                depth_meters: depth,
                intake_type: 'well',
                dist_km: dist,
            });
        }

        it('median 10м (5 wells: 5/8/10/12/15) → "0-15m / Верховодка"', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                wellRow(5),
                wellRow(8),
                wellRow(10),
                wellRow(12),
                wellRow(15, 2),
            ]);
            const res = await service.predict(buildDto());
            // median percentile из [5,8,10,12,15] на idx=2 → 10. 10 < 15 → Верховодка.
            expect(res.mostLikelyAquiferLayer).toBe('0-15m / Верховодка');
        });

        it('median ~30м (15-50м диапазон) → "15-50m / Песчаный"', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                wellRow(20),
                wellRow(25),
                wellRow(30),
                wellRow(35),
                wellRow(40),
            ]);
            const res = await service.predict(buildDto());
            expect(res.mostLikelyAquiferLayer).toBe('15-50m / Песчаный');
        });

        it('median ~75м → "50-100m / Песчано-известняковый"', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                wellRow(60),
                wellRow(70),
                wellRow(75),
                wellRow(80),
                wellRow(90),
            ]);
            const res = await service.predict(buildDto());
            expect(res.mostLikelyAquiferLayer).toBe('50-100m / Песчано-известняковый');
        });

        it('median ~150м → "100-200m / Известняковый"', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                wellRow(120),
                wellRow(140),
                wellRow(150),
                wellRow(160),
                wellRow(180),
            ]);
            const res = await service.predict(buildDto());
            expect(res.mostLikelyAquiferLayer).toBe('100-200m / Известняковый');
        });

        it('median 250м → "200m+ / Артезианский"', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                wellRow(220),
                wellRow(240),
                wellRow(250),
                wellRow(260),
                wellRow(280),
            ]);
            const res = await service.predict(buildDto());
            expect(res.mostLikelyAquiferLayer).toBe('200m+ / Артезианский');
        });

        it('< 5 wells с depth → undefined (порог AQUIFER_MIN_NEIGHBORS=5)', async () => {
            // 4 well — недостаточно для k-anonymity hardening.
            prisma.$queryRaw.mockResolvedValueOnce([
                wellRow(50),
                wellRow(55),
                wellRow(60),
                wellRow(65),
            ]);
            const res = await service.predict(buildDto());
            expect(res.mostLikelyAquiferLayer).toBeUndefined();
        });

        it('intake_type=municipal/spring не учитываются в aquifer median', async () => {
            // 4 well + 1 municipal + 1 spring → wells=4, < 5 → undefined.
            prisma.$queryRaw.mockResolvedValueOnce([
                wellRow(50),
                wellRow(55),
                wellRow(60, 2),
                wellRow(65, 2),
                buildRow({ depth_meters: 100, intake_type: 'municipal', dist_km: 3 }),
                buildRow({ depth_meters: 200, intake_type: 'spring', dist_km: 4 }),
            ]);
            const res = await service.predict(buildDto());
            expect(res.mostLikelyAquiferLayer).toBeUndefined();
        });

        it('well_dug учитывается наравне с well', async () => {
            // 5 well_dug → достаточно для aquifer (порог 5 после security-fix 2026-05-08).
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ depth_meters: 5, intake_type: 'well_dug', dist_km: 1 }),
                buildRow({ depth_meters: 7, intake_type: 'well_dug', dist_km: 1.5 }),
                buildRow({ depth_meters: 8, intake_type: 'well_dug', dist_km: 2 }),
                buildRow({ depth_meters: 9, intake_type: 'well_dug', dist_km: 2.5 }),
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
    // pdkStatus — interval-aware, 4-level severity (safe/borderline/concerning/unsafe)
    //
    // Пограничные случаи покрываем по обеим осям:
    //   - single ПДК (iron 0.3, manganese 0.1): четыре исхода
    //   - range ПДК (ph 6-9): четыре исхода
    //   - non-regulated (temperature, electrical_conductivity, unknown): null
    //
    // Концептуальное различие borderline vs concerning — медиана:
    //   crosses & median ≤ pdk → borderline   (большинство в норме)
    //   crosses & median > pdk → concerning   (большинство превышает)
    // -----------------------------------------------------------------------

    describe('pdkStatus — interval-aware (4-level severity)', () => {
        // -------- single-pdk параметры (iron_total: 0.3) --------

        it('iron_total: все соседи < 0.3 (interval upper ≤ 0.3) → safe', async () => {
            // values [0.05..0.15] → interval ~ [0.054, 0.146], упор < 0.3 → safe.
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { iron_total: 0.05 }, dist_km: 1 }),
                buildRow({ params: { iron_total: 0.08 }, dist_km: 1 }),
                buildRow({ params: { iron_total: 0.1 }, dist_km: 1 }),
                buildRow({ params: { iron_total: 0.12 }, dist_km: 1 }),
                buildRow({ params: { iron_total: 0.15 }, dist_km: 1 }),
            ]);
            const res = await service.predict(buildDto());
            const iron = res.predicted.iron_total;
            expect(iron.interval.upper).toBeLessThanOrEqual(0.3);
            expect(iron.pdkStatus).toBe('safe');
        });

        it('iron_total: все соседи > 0.3 (interval lower > 0.3) → unsafe', async () => {
            // values [0.5..1.0] → interval lower > 0.3 → unsafe.
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { iron_total: 0.5 }, dist_km: 1 }),
                buildRow({ params: { iron_total: 0.6 }, dist_km: 1 }),
                buildRow({ params: { iron_total: 0.7 }, dist_km: 1 }),
                buildRow({ params: { iron_total: 0.8 }, dist_km: 1 }),
                buildRow({ params: { iron_total: 1.0 }, dist_km: 1 }),
            ]);
            const res = await service.predict(buildDto());
            const iron = res.predicted.iron_total;
            expect(iron.interval.lower).toBeGreaterThan(0.3);
            expect(iron.pdkStatus).toBe('unsafe');
        });

        it('iron_total: crosses ПДК + median ≤ pdk → borderline (большинство в норме)', async () => {
            // sorted=[0.05, 0.1, 0.15, 0.2, 0.6] (n=5).
            //   P10 idx=0.4 → 0.05*0.6 + 0.1*0.4 = 0.07
            //   P50 idx=2   → 0.15  (≤ 0.3 → borderline ветка)
            //   P90 idx=3.6 → 0.2*0.4 + 0.6*0.6 = 0.44
            // interval=[0.07, 0.44] crosses 0.3, median=0.15 ≤ 0.3 → borderline.
            const sampleDate = new Date('2026-05-01');
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { iron_total: 0.05 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { iron_total: 0.1 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { iron_total: 0.15 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { iron_total: 0.2 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { iron_total: 0.6 }, dist_km: 1, sample_date: sampleDate }),
            ]);
            const res = await service.predict(buildDto());
            const iron = res.predicted.iron_total;
            expect(iron.interval.lower).toBeLessThanOrEqual(0.3);
            expect(iron.interval.upper).toBeGreaterThan(0.3);
            expect(iron.pdkStatus).toBe('borderline');
        });

        it('iron_total: crosses ПДК + median > pdk → concerning (большинство превышает)', async () => {
            // sorted=[0.05, 0.1, 0.5, 0.6, 0.8, 1.0, 1.2] (n=7).
            //   P10 idx=0.6 → 0.05*0.4 + 0.1*0.6 = 0.08
            //   P50 idx=3   → 0.6  (> 0.3 → concerning ветка)
            //   P90 idx=5.4 → 1.0*0.6 + 1.2*0.4 = 1.08
            // interval=[0.08, 1.08] crosses 0.3, median=0.6 > 0.3 → concerning.
            const sampleDate = new Date('2026-05-01');
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { iron_total: 0.05 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { iron_total: 0.1 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { iron_total: 0.5 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { iron_total: 0.6 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { iron_total: 0.8 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { iron_total: 1.0 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { iron_total: 1.2 }, dist_km: 1, sample_date: sampleDate }),
            ]);
            const res = await service.predict(buildDto());
            const iron = res.predicted.iron_total;
            expect(iron.interval.lower).toBeLessThanOrEqual(0.3);
            expect(iron.interval.upper).toBeGreaterThan(0.3);
            expect(iron.pdkStatus).toBe('concerning');
        });

        it('manganese: interval upper ≤ 0.1 → safe (single-pdk 0.1)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { manganese: 0.02 }, dist_km: 1 }),
                buildRow({ params: { manganese: 0.04 }, dist_km: 1 }),
                buildRow({ params: { manganese: 0.05 }, dist_km: 1 }),
            ]);
            const res = await service.predict(buildDto());
            expect(res.predicted.manganese.pdkStatus).toBe('safe');
        });

        it('manganese: crosses 0.1 + median > 0.1 → concerning', async () => {
            // sorted=[0.02, 0.05, 0.12, 0.15, 0.2, 0.25, 0.3] (n=7), pdk=0.1.
            //   P10 idx=0.6 → 0.02*0.4 + 0.05*0.6 = 0.038
            //   P50 idx=3   → 0.15  (> 0.1 → concerning)
            //   P90 idx=5.4 → 0.25*0.6 + 0.3*0.4 = 0.27
            const sampleDate = new Date('2026-05-01');
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { manganese: 0.02 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { manganese: 0.05 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { manganese: 0.12 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { manganese: 0.15 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { manganese: 0.2 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { manganese: 0.25 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { manganese: 0.3 }, dist_km: 1, sample_date: sampleDate }),
            ]);
            const res = await service.predict(buildDto());
            const mn = res.predicted.manganese;
            expect(mn.interval.lower).toBeLessThanOrEqual(0.1);
            expect(mn.interval.upper).toBeGreaterThan(0.1);
            expect(mn.pdkStatus).toBe('concerning');
        });

        it('boundary: median ровно равна pdk → borderline (median > pdk = false)', async () => {
            // sorted=[0.05, 0.15, 0.3, 0.5, 0.8] (n=5), pdk=0.3.
            //   P50 idx=2 → 0.3   (median == pdk, оператор ">", не ">=" → borderline)
            // Тонкий boundary edge: подтверждаем что условие median > pdk строгое.
            const sampleDate = new Date('2026-05-01');
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { iron_total: 0.05 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { iron_total: 0.15 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { iron_total: 0.3 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { iron_total: 0.5 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { iron_total: 0.8 }, dist_km: 1, sample_date: sampleDate }),
            ]);
            const res = await service.predict(buildDto());
            const iron = res.predicted.iron_total;
            expect(iron.pdkStatus).toBe('borderline');
        });

        // -------- range-pdk параметры (ph: [6, 9]) --------

        it('ph: соседи в [6, 9] (например 7-8) → safe', async () => {
            const sampleDate = new Date('2026-05-01');
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { ph: 7.0 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { ph: 7.3 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { ph: 7.5 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { ph: 7.8 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { ph: 8.0 }, dist_km: 1, sample_date: sampleDate }),
            ]);
            const res = await service.predict(buildDto());
            const ph = res.predicted.ph;
            expect(ph.interval.lower).toBeGreaterThanOrEqual(6);
            expect(ph.interval.upper).toBeLessThanOrEqual(9);
            expect(ph.pdkStatus).toBe('safe');
        });

        it('ph: completely below 6 (все 5.0) → unsafe', async () => {
            const sampleDate = new Date('2026-05-01');
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { ph: 4.5 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { ph: 4.8 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { ph: 5.0 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { ph: 5.2 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { ph: 5.5 }, dist_km: 1, sample_date: sampleDate }),
            ]);
            const res = await service.predict(buildDto());
            const ph = res.predicted.ph;
            expect(ph.interval.upper).toBeLessThan(6);
            expect(ph.pdkStatus).toBe('unsafe');
        });

        it('ph: completely above 9 (все 10.5) → unsafe', async () => {
            const sampleDate = new Date('2026-05-01');
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { ph: 10.0 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { ph: 10.3 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { ph: 10.5 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { ph: 10.8 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { ph: 11.0 }, dist_km: 1, sample_date: sampleDate }),
            ]);
            const res = await service.predict(buildDto());
            const ph = res.predicted.ph;
            expect(ph.interval.lower).toBeGreaterThan(9);
            expect(ph.pdkStatus).toBe('unsafe');
        });

        it('ph: crosses border + median внутри range (5.5-7.5) → borderline', async () => {
            // sorted=[5.5, 6.0, 6.5, 7.0, 7.5] (n=5), range=[6, 9].
            //   P10 idx=0.4 → 5.5*0.6 + 6.0*0.4 = 5.7  (< 6 → crosses min)
            //   P50 idx=2   → 6.5  (внутри [6, 9] → borderline ветка)
            //   P90 idx=3.6 → 7.0*0.4 + 7.5*0.6 = 7.3
            const sampleDate = new Date('2026-05-01');
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { ph: 5.5 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { ph: 6.0 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { ph: 6.5 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { ph: 7.0 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { ph: 7.5 }, dist_km: 1, sample_date: sampleDate }),
            ]);
            const res = await service.predict(buildDto());
            const ph = res.predicted.ph;
            expect(ph.pdkStatus).toBe('borderline');
        });

        it('ph: crosses border + median вне range → concerning', async () => {
            // sorted=[3, 4, 4.5, 5, 5.5, 7, 7.5] (n=7), range=[6, 9].
            //   P10 idx=0.6 → 3*0.4 + 4*0.6 = 3.6
            //   P50 idx=3   → 5.0  (5 < 6 → median вне → concerning ветка)
            //   P90 idx=5.4 → 7*0.6 + 7.5*0.4 = 7.2  (внутри → crosses, не unsafe)
            // interval=[3.6, 7.2] crosses min=6, median=5 < 6 → concerning.
            const sampleDate = new Date('2026-05-01');
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { ph: 3 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { ph: 4 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { ph: 4.5 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { ph: 5 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { ph: 5.5 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { ph: 7 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { ph: 7.5 }, dist_km: 1, sample_date: sampleDate }),
            ]);
            const res = await service.predict(buildDto());
            const ph = res.predicted.ph;
            expect(ph.interval.lower).toBeLessThan(6);
            expect(ph.interval.upper).toBeLessThanOrEqual(9);
            expect(ph.pdkStatus).toBe('concerning');
        });

        it('ph: crosses border сверху + median выше max → concerning', async () => {
            // Симметричный кейс: интервал перешагнул верхнюю границу 9, медиана > 9.
            // sorted=[7, 8, 9, 10, 10.5, 11, 11.5] (n=7), range=[6, 9].
            //   P10 idx=0.6 → 7*0.4 + 8*0.6 = 7.6  (внутри → crosses max, не unsafe)
            //   P50 idx=3   → 10  (> 9 → median вне → concerning ветка)
            //   P90 idx=5.4 → 11*0.6 + 11.5*0.4 = 11.2
            const sampleDate = new Date('2026-05-01');
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { ph: 7 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { ph: 8 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { ph: 9 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { ph: 10 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { ph: 10.5 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { ph: 11 }, dist_km: 1, sample_date: sampleDate }),
                buildRow({ params: { ph: 11.5 }, dist_km: 1, sample_date: sampleDate }),
            ]);
            const res = await service.predict(buildDto());
            const ph = res.predicted.ph;
            expect(ph.interval.lower).toBeLessThanOrEqual(9);
            expect(ph.interval.upper).toBeGreaterThan(9);
            expect(ph.pdkStatus).toBe('concerning');
        });

        // -------- non-regulated параметры --------

        it('temperature (не нормируется СанПиН) → pdkStatus=null', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { temperature: 12 }, dist_km: 1 }),
            ]);
            const res = await service.predict(buildDto());
            expect(res.predicted.temperature.pdkStatus).toBeNull();
        });

        it('electrical_conductivity (не нормируется) → pdkStatus=null', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { electrical_conductivity: 800 }, dist_km: 1 }),
            ]);
            const res = await service.predict(buildDto());
            expect(res.predicted.electrical_conductivity.pdkStatus).toBeNull();
        });

        it('unknown paramCode → pdkStatus=null (нет meta в WATER_PARAMS_BY_CODE)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { totally_unknown_param: 0.42 }, dist_km: 1 }),
            ]);
            const res = await service.predict(buildDto());
            expect(res.predicted.totally_unknown_param.pdkStatus).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // byCategory — UI shortcut: paramCodes сгруппированы по pdkStatus
    // -----------------------------------------------------------------------

    describe('byCategory (group paramCodes by pdkStatus)', () => {
        it('5 buckets всегда возвращаются (unsafe/concerning/borderline/safe/unmonitored)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { iron_total: 0.1 }, dist_km: 1 }),
            ]);
            const res = await service.predict(buildDto());

            expect(res.byCategory).toBeDefined();
            expect(res.byCategory.unsafe).toEqual(expect.any(Array));
            expect(res.byCategory.concerning).toEqual(expect.any(Array));
            expect(res.byCategory.borderline).toEqual(expect.any(Array));
            expect(res.byCategory.safe).toEqual(expect.any(Array));
            expect(res.byCategory.unmonitored).toEqual(expect.any(Array));
        });

        it('распределение paramCodes по 5 buckets соответствует pdkStatus', async () => {
            // Mix: iron_total safe (n=1, 0.1 < 0.3); manganese unsafe (один сосед 0.5 > 0.1);
            // temperature unmonitored (нет ПДК).
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({
                    params: { iron_total: 0.1, manganese: 0.5, temperature: 12 },
                    dist_km: 1,
                }),
            ]);
            const res = await service.predict(buildDto());

            expect(res.byCategory.safe).toContain('iron_total');
            expect(res.byCategory.unsafe).toContain('manganese');
            expect(res.byCategory.unmonitored).toContain('temperature');
        });

        it('параметр без данных у соседей НЕ попадает ни в один bucket', async () => {
            // Только iron_total передан → manganese / hardness_total etc отсутствуют
            // в predicted, значит не должны быть в buckets.
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { iron_total: 0.1 }, dist_km: 1 }),
            ]);
            const res = await service.predict(buildDto());

            const allCodes = [
                ...res.byCategory.unsafe,
                ...res.byCategory.concerning,
                ...res.byCategory.borderline,
                ...res.byCategory.safe,
                ...res.byCategory.unmonitored,
            ];
            expect(allCodes).toEqual(['iron_total']);
        });

        it('проблемные buckets (unsafe/concerning/borderline) sorted by pointEstimate desc', async () => {
            // 2 unsafe-параметра: iron_total (point ≈ 1.0) и manganese (point ≈ 0.6).
            // Ожидаем: byCategory.unsafe = ['iron_total', 'manganese'] (более тяжёлый первым).
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({
                    params: { iron_total: 1.0, manganese: 0.6 },
                    dist_km: 1,
                }),
            ]);
            const res = await service.predict(buildDto());

            expect(res.byCategory.unsafe).toEqual(['iron_total', 'manganese']);
        });

        it('safe/unmonitored buckets sorted by paramCode alphabetically', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                // 2 safe + 2 unmonitored
                buildRow({
                    params: {
                        manganese: 0.02,
                        iron_total: 0.05,
                        temperature: 12,
                        electrical_conductivity: 800,
                    },
                    dist_km: 1,
                }),
            ]);
            const res = await service.predict(buildDto());

            // Alphabetical: iron_total < manganese, electrical_conductivity < temperature.
            expect(res.byCategory.safe).toEqual(['iron_total', 'manganese']);
            expect(res.byCategory.unmonitored).toEqual(['electrical_conductivity', 'temperature']);
        });

        it('insufficientData (no neighbors) → все 5 buckets пустые', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.predict(buildDto());

            expect(res.byCategory).toEqual({
                unsafe: [],
                concerning: [],
                borderline: [],
                safe: [],
                unmonitored: [],
            });
        });
    });

    // -----------------------------------------------------------------------
    // Cache hit / miss / errors
    // -----------------------------------------------------------------------

    describe('cache behaviour', () => {
        it('cache hit: redis.get → valid JSON → response.cached=true, нет SQL', async () => {
            const cached: PredictResponseDto = {
                predicted: {
                    iron_total: {
                        interval: { lower: 0.18, upper: 0.72, confidence: 80 },
                        iqr: { lower: 0.25, upper: 0.55, confidence: 50 },
                        hardRange: { lower: 0.05, upper: 1.5, confidence: 100 },
                        pointEstimate: 0.42,
                        n: 18,
                        pdkStatus: 'borderline',
                    },
                },
                byCategory: {
                    unsafe: [],
                    concerning: [],
                    borderline: ['iron_total'],
                    safe: [],
                    unmonitored: [],
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
            expect(res.predicted.iron_total.pointEstimate).toBe(0.42);
            expect(res.predicted.iron_total.pdkStatus).toBe('borderline');
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
            expect(redis.get).toHaveBeenCalledWith('predict:v5:55.756:37.617:20:50.000');
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
            expect(res.predicted.iron_total.pointEstimate).toBe(0.4);
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
            expect(res.predicted.iron_total.pointEstimate).toBe(0.5);
        });

        it('Infinity → пропускается (Number.isFinite фильтр)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { iron_total: Number.POSITIVE_INFINITY }, dist_km: 1 }),
                buildRow({ params: { iron_total: 0.3 }, dist_km: 2 }),
            ]);
            const res = await service.predict(buildDto());
            expect(res.predicted.iron_total.n).toBe(1);
            expect(res.predicted.iron_total.pointEstimate).toBe(0.3);
        });
    });

    // -----------------------------------------------------------------------
    // roundTo — 4 знака
    // -----------------------------------------------------------------------

    describe('roundTo (4 digits)', () => {
        it('pointEstimate и intervals округляются до 4 знаков', async () => {
            // value=0.123456789 у одного соседа → round → 0.1235.
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { iron_total: 0.123456789 }, dist_km: 1 }),
            ]);
            const res = await service.predict(buildDto());
            const iron = res.predicted.iron_total;
            expect(iron.pointEstimate).toBe(0.1235);
            expect(iron.interval.lower).toBe(0.1235);
            expect(iron.interval.upper).toBe(0.1235);
            expect(iron.iqr.lower).toBe(0.1235);
            expect(iron.iqr.upper).toBe(0.1235);
            expect(iron.hardRange.lower).toBe(0.1235);
            expect(iron.hardRange.upper).toBe(0.1235);
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

        it('содержит все required поля при наличии соседей (interval-first shape)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { iron_total: 0.4, manganese: 0.05 }, dist_km: 1 }),
            ]);
            const res = await service.predict(buildDto());

            expect(res.predicted.iron_total).toEqual(
                expect.objectContaining({
                    interval: expect.objectContaining({
                        lower: expect.any(Number),
                        upper: expect.any(Number),
                        confidence: 80,
                    }),
                    iqr: expect.objectContaining({
                        lower: expect.any(Number),
                        upper: expect.any(Number),
                        confidence: 50,
                    }),
                    hardRange: expect.objectContaining({
                        lower: expect.any(Number),
                        upper: expect.any(Number),
                        confidence: 100,
                    }),
                    pointEstimate: expect.any(Number),
                    n: 1,
                    // pdkStatus: либо строка ('safe'/'borderline'/'concerning'/'unsafe') либо null.
                    pdkStatus: expect.anything(),
                }),
            );
            expect(res.predicted.manganese).toBeDefined();
            expect(res.nNeighbors).toBe(1);
            expect(res.cached).toBe(false);
            expect(res.insufficientData).toBe(false);
        });
    });
});
