import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '@slovo/database';
import {
    AQUIFER_LAYERS,
    DEPTH_PREDICT_CACHE_TTL_SECONDS,
    DEPTH_PREDICT_DEFAULT_K,
    DEPTH_PREDICT_DEFAULT_RADIUS_KM,
    DEPTH_PREDICT_REDIS_TOKEN,
} from '../water-analysis.constants';
import { DepthPredictService } from './depth-predict.service';
import type { DepthPredictQueryDto } from './dto/depth-predict.request.dto';
import type { DepthPredictResponseDto } from './dto/depth-predict.response.dto';

// =============================================================================
// DepthPredictService unit-тесты — kNN-прогноз глубины бурения (USP-4),
// interval-first философия (3 уровня intervals + pointEstimate + layer
// distribution). Мокаем Prisma.$queryRaw + Redis (get/set), проверяем internal
// helpers (computeDepthEstimate / computeLayerDistribution / computeMostLikely
// AquiferLayer / buildCacheKey) через public API service.predict().
//
// Real PostgreSQL + PostGIS НЕ нужны (e2e под отдельный testcontainer setup).
// =============================================================================

type TNeighborRow = {
    depth: number;
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

describe('DepthPredictService', () => {
    let service: DepthPredictService;
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
                DepthPredictService,
                { provide: PrismaService, useValue: prisma },
                { provide: DEPTH_PREDICT_REDIS_TOKEN, useValue: redis },
            ],
        }).compile();
        service = moduleRef.get(DepthPredictService);
    }

    function buildDto(overrides: Partial<DepthPredictQueryDto> = {}): DepthPredictQueryDto {
        return {
            lat: overrides.lat ?? 55.7558,
            lon: overrides.lon ?? 37.6173,
            intakeType: overrides.intakeType,
            k: overrides.k,
            radiusKm: overrides.radiusKm,
        } as DepthPredictQueryDto;
    }

    function buildRow(overrides: Partial<TNeighborRow> = {}): TNeighborRow {
        return {
            depth: overrides.depth ?? 30,
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
    // Math: distance + recency weighting (pointEstimate)
    // -----------------------------------------------------------------------

    describe('Math: distance + recency weighting', () => {
        it('ближайший + свежий сосед имеет больший вклад в pointEstimate чем дальний + старый', async () => {
            // Closest+recent: depth=10м, dist=0км (weight≈1), today (recency=1) → weight≈1.
            // Far+old: depth=100м, dist=50км (weight≈0.167), 10 лет (recency≈0.135) → weight≈0.0225.
            // pointEstimate = (10*1 + 100*0.0225)/(1+0.0225) ≈ 11.98 — близко к 10, далеко от 100.
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({
                    depth: 10,
                    dist_km: 0,
                    sample_date: new Date('2026-05-08'), // today
                }),
                buildRow({
                    depth: 100,
                    dist_km: 50,
                    sample_date: new Date('2016-05-08'), // 10 years old
                }),
            ]);

            const res = await service.predict(buildDto());

            expect(res.predicted).not.toBeNull();
            // Серединное значение было бы 55. С весами — близко к 10.
            expect(res.predicted!.pointEstimate).toBeLessThan(20);
            expect(res.predicted!.pointEstimate).toBeGreaterThanOrEqual(10);
            expect(res.predicted!.n).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // 3 levels intervals
    // -----------------------------------------------------------------------

    describe('3 levels intervals (interval/iqr/hardRange)', () => {
        it('values=[10, 20, 30, 40, 50] → interval=[14, 46], iqr=[20, 40], hardRange=[10, 50]', async () => {
            // percentile linear-interp на 5 точках:
            //   P10 idx=0.4 между sorted[0]=10 и sorted[1]=20 → 10*0.6+20*0.4 = 14
            //   P25 idx=1.0 → sorted[1] = 20
            //   P75 idx=3.0 → sorted[3] = 40
            //   P90 idx=3.6 между sorted[3]=40 и sorted[4]=50 → 40*0.4+50*0.6 = 46
            //   min/max → 10/50
            const sampleDate = new Date('2026-05-01');
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ depth: 10, dist_km: 1, sample_date: sampleDate }),
                buildRow({ depth: 20, dist_km: 1, sample_date: sampleDate }),
                buildRow({ depth: 30, dist_km: 1, sample_date: sampleDate }),
                buildRow({ depth: 40, dist_km: 1, sample_date: sampleDate }),
                buildRow({ depth: 50, dist_km: 1, sample_date: sampleDate }),
            ]);

            const res = await service.predict(buildDto());
            const est = res.predicted;

            expect(est).not.toBeNull();
            expect(est!.interval.lower).toBeCloseTo(14, 1);
            expect(est!.interval.upper).toBeCloseTo(46, 1);
            expect(est!.interval.confidence).toBe(80);

            expect(est!.iqr.lower).toBeCloseTo(20, 1);
            expect(est!.iqr.upper).toBeCloseTo(40, 1);
            expect(est!.iqr.confidence).toBe(50);

            expect(est!.hardRange.lower).toBe(10);
            expect(est!.hardRange.upper).toBe(50);
            expect(est!.hardRange.confidence).toBe(100);

            expect(est!.n).toBe(5);
        });
    });

    // -----------------------------------------------------------------------
    // Empty neighbors → predicted=null + insufficientData=true
    // -----------------------------------------------------------------------

    describe('empty neighbors', () => {
        it('SQL вернул [] → predicted=null, insufficientData=true, layerDistribution всё ещё 5 buckets', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.predict(buildDto());

            expect(res.predicted).toBeNull();
            expect(res.insufficientData).toBe(true);
            expect(res.nNeighbors).toBe(0);
            expect(res.mostLikelyAquiferLayer).toBeUndefined();
            expect(res.medianDistKm).toBe(0);

            // layerDistribution всегда 5 buckets даже при empty input.
            expect(res.layerDistribution).toHaveLength(5);
            for (const bucket of res.layerDistribution) {
                expect(bucket.count).toBe(0);
                expect(bucket.pct).toBe(0);
            }
            // ids в стабильном порядке из AQUIFER_LAYERS.
            expect(res.layerDistribution.map((b) => b.id)).toEqual(
                AQUIFER_LAYERS.map((l) => l.id),
            );
        });
    });

    // -----------------------------------------------------------------------
    // mostLikelyAquiferLayer — по медиане depths
    // -----------------------------------------------------------------------

    describe('mostLikelyAquiferLayer', () => {
        // Все happy-path сценарии — 5 rows (порог AQUIFER_MIN_NEIGHBORS=5,
        // поднят с 3 в security-fix 2026-05-08 для PII hardening).
        it('median 8м → "0-15m / Верховодка"', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ depth: 5 }),
                buildRow({ depth: 7 }),
                buildRow({ depth: 8 }),
                buildRow({ depth: 10 }),
                buildRow({ depth: 12 }),
            ]);
            const res = await service.predict(buildDto());
            expect(res.mostLikelyAquiferLayer).toBe('0-15m / Верховодка');
        });

        it('median 30м → "15-50m / Песчаный"', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ depth: 20 }),
                buildRow({ depth: 25 }),
                buildRow({ depth: 30 }),
                buildRow({ depth: 35 }),
                buildRow({ depth: 40 }),
            ]);
            const res = await service.predict(buildDto());
            expect(res.mostLikelyAquiferLayer).toBe('15-50m / Песчаный');
        });

        it('median 75м → "50-100m / Песчано-известняковый"', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ depth: 60 }),
                buildRow({ depth: 70 }),
                buildRow({ depth: 75 }),
                buildRow({ depth: 80 }),
                buildRow({ depth: 90 }),
            ]);
            const res = await service.predict(buildDto());
            expect(res.mostLikelyAquiferLayer).toBe('50-100m / Песчано-известняковый');
        });

        it('median 150м → "100-200m / Известняковый"', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ depth: 120 }),
                buildRow({ depth: 140 }),
                buildRow({ depth: 150 }),
                buildRow({ depth: 160 }),
                buildRow({ depth: 180 }),
            ]);
            const res = await service.predict(buildDto());
            expect(res.mostLikelyAquiferLayer).toBe('100-200m / Известняковый');
        });

        it('median 250м → "200m+ / Артезианский"', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ depth: 220 }),
                buildRow({ depth: 240 }),
                buildRow({ depth: 250 }),
                buildRow({ depth: 260 }),
                buildRow({ depth: 280 }),
            ]);
            const res = await service.predict(buildDto());
            expect(res.mostLikelyAquiferLayer).toBe('200m+ / Артезианский');
        });

        it('< 5 соседей → mostLikelyAquiferLayer undefined (даже если depths валидные)', async () => {
            // Порог AQUIFER_MIN_NEIGHBORS поднят с 3 до 5 в security-fix 2026-05-08
            // для k-anonymity при kNN с малым radius.
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ depth: 50 }),
                buildRow({ depth: 55 }),
                buildRow({ depth: 60 }),
                buildRow({ depth: 65 }),
            ]);
            const res = await service.predict(buildDto());
            expect(res.mostLikelyAquiferLayer).toBeUndefined();
            // predicted всё ещё не null — есть 4 соседа (interval-первый прогноз
            // не зависит от aquifer-floor, считаем для любого ≥1).
            expect(res.predicted).not.toBeNull();
            expect(res.predicted!.n).toBe(4);
        });
    });

    // -----------------------------------------------------------------------
    // layerDistribution — всегда 5 buckets, % rounded
    // -----------------------------------------------------------------------

    describe('layerDistribution', () => {
        it('всегда 5 buckets даже когда часть пустые (ids/labels из AQUIFER_LAYERS)', async () => {
            // 5 соседей все в sandy (15-50м) → layer_sandy=5, остальные 4 пустые.
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ depth: 20 }),
                buildRow({ depth: 25 }),
                buildRow({ depth: 30 }),
                buildRow({ depth: 35 }),
                buildRow({ depth: 40 }),
            ]);
            const res = await service.predict(buildDto());

            expect(res.layerDistribution).toHaveLength(5);
            const ids = res.layerDistribution.map((b) => b.id);
            const labels = res.layerDistribution.map((b) => b.label);
            expect(ids).toEqual(AQUIFER_LAYERS.map((l) => l.id));
            expect(labels).toEqual(AQUIFER_LAYERS.map((l) => l.label));

            const counts = res.layerDistribution.map((b) => b.count);
            expect(counts).toEqual([0, 5, 0, 0, 0]);
        });

        it('100% pct когда все в одном bucket', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ depth: 80 }),
                buildRow({ depth: 70 }),
                buildRow({ depth: 90 }),
                buildRow({ depth: 60 }),
            ]);
            const res = await service.predict(buildDto());

            const sandyLimestone = res.layerDistribution.find((b) => b.id === 'sandy_limestone');
            expect(sandyLimestone).toBeDefined();
            expect(sandyLimestone!.count).toBe(4);
            expect(sandyLimestone!.pct).toBe(100);

            // Остальные buckets — 0.
            const others = res.layerDistribution.filter((b) => b.id !== 'sandy_limestone');
            for (const b of others) {
                expect(b.count).toBe(0);
                expect(b.pct).toBe(0);
            }
        });

        it('pct округляется до целого: count=12/total=23 → 52%', async () => {
            // 12 в sandy + 11 в sandy_limestone (всего 23).
            // 12/23 = 52.17 → 52, 11/23 = 47.83 → 48.
            const rows: TNeighborRow[] = [];
            for (let i = 0; i < 12; i++) rows.push(buildRow({ depth: 25 + i })); // sandy
            for (let i = 0; i < 11; i++) rows.push(buildRow({ depth: 60 + i })); // sandy_limestone
            prisma.$queryRaw.mockResolvedValueOnce(rows);

            const res = await service.predict(buildDto());

            const sandy = res.layerDistribution.find((b) => b.id === 'sandy')!;
            const sandyLimestone = res.layerDistribution.find((b) => b.id === 'sandy_limestone')!;
            expect(sandy.count).toBe(12);
            expect(sandy.pct).toBe(52);
            expect(sandyLimestone.count).toBe(11);
            expect(sandyLimestone.pct).toBe(48);
        });

        it('mixed distribution — counts корректно распределены по 5 buckets', async () => {
            // 1 top_water + 6 sandy + 2 sandy_limestone + 1 limestone + 0 artesian = 10.
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ depth: 5 }), // top_water
                buildRow({ depth: 20 }), // sandy
                buildRow({ depth: 25 }), // sandy
                buildRow({ depth: 30 }), // sandy
                buildRow({ depth: 35 }), // sandy
                buildRow({ depth: 40 }), // sandy
                buildRow({ depth: 45 }), // sandy
                buildRow({ depth: 60 }), // sandy_limestone
                buildRow({ depth: 75 }), // sandy_limestone
                buildRow({ depth: 150 }), // limestone
            ]);
            const res = await service.predict(buildDto());

            const counts = res.layerDistribution.map((b) => b.count);
            expect(counts).toEqual([1, 6, 2, 1, 0]);
            const pcts = res.layerDistribution.map((b) => b.pct);
            expect(pcts).toEqual([10, 60, 20, 10, 0]);
        });
    });

    // -----------------------------------------------------------------------
    // Default values when k / radiusKm / intakeType omitted
    // -----------------------------------------------------------------------

    describe('default values', () => {
        it('intakeType undefined → "well" (default echo в response)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.predict(buildDto({ intakeType: undefined }));
            expect(res.intakeType).toBe('well');
        });

        it('radiusKm undefined → DEPTH_PREDICT_DEFAULT_RADIUS_KM (50)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.predict(buildDto({ radiusKm: undefined }));
            expect(res.radiusKm).toBe(DEPTH_PREDICT_DEFAULT_RADIUS_KM);
        });

        it('k undefined → cache key содержит DEPTH_PREDICT_DEFAULT_K (20)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            await service.predict(buildDto({ k: undefined }));
            const key = redis.get.mock.calls[0][0] as string;
            expect(key).toContain(`:${DEPTH_PREDICT_DEFAULT_K}:`);
        });
    });

    // -----------------------------------------------------------------------
    // buildIntakeFilter — три варианта intakeType.
    // Через факт что $queryRaw зовётся ровно 1 раз и intakeType echo'ится в response.
    // -----------------------------------------------------------------------

    describe('buildIntakeFilter — три варианта intakeType', () => {
        it("intakeType='all' — SQL зовётся, response.intakeType='all'", async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.predict(buildDto({ intakeType: 'all' }));
            expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
            expect(res.intakeType).toBe('all');
        });

        it("intakeType='well' — SQL зовётся, response.intakeType='well'", async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.predict(buildDto({ intakeType: 'well' }));
            expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
            expect(res.intakeType).toBe('well');
        });

        it("intakeType='well_dug' — SQL зовётся, response.intakeType='well_dug'", async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.predict(buildDto({ intakeType: 'well_dug' }));
            expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
            expect(res.intakeType).toBe('well_dug');
        });
    });

    // -----------------------------------------------------------------------
    // buildCacheKey — формат + округление до 0.001° + intakeType isolation
    // -----------------------------------------------------------------------

    describe('cache key', () => {
        it('формат ключа: depth-predict:<intake>:<lat>:<lon>:<k>:<radiusKm>', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            await service.predict(
                buildDto({
                    lat: 55.7558,
                    lon: 37.6173,
                    intakeType: 'well',
                    k: 20,
                    radiusKm: 50,
                }),
            );
            expect(redis.get).toHaveBeenCalledWith('depth-predict:v5:well:55.756:37.617:20:50.000');
        });

        it('координаты различающиеся менее чем на 0.001° → одинаковый cache-key', async () => {
            prisma.$queryRaw.mockResolvedValue([]);
            await service.predict(buildDto({ lat: 55.123456, lon: 37.654321 }));
            await service.predict(buildDto({ lat: 55.1234, lon: 37.6543 }));
            const keys = redis.get.mock.calls.map((c) => c[0] as string);
            expect(keys[0]).toBe(keys[1]);
        });

        it('разные intakeType при тех же координатах → разные cache-keys (изоляция фильтра)', async () => {
            prisma.$queryRaw.mockResolvedValue([]);
            await service.predict(buildDto({ intakeType: 'all' }));
            await service.predict(buildDto({ intakeType: 'well' }));
            await service.predict(buildDto({ intakeType: 'well_dug' }));
            const keys = redis.get.mock.calls.map((c) => c[0] as string);
            expect(new Set(keys).size).toBe(3);
            expect(keys[0]).toMatch(/^depth-predict:v\d+:all:/);
            expect(keys[1]).toMatch(/^depth-predict:v\d+:well:/);
            expect(keys[2]).toMatch(/^depth-predict:v\d+:well_dug:/);
        });
    });

    // -----------------------------------------------------------------------
    // Cache hit / miss / errors
    // -----------------------------------------------------------------------

    describe('cache behaviour', () => {
        it('cache hit: redis.get → valid JSON → response.cached=true, нет SQL', async () => {
            const cached: DepthPredictResponseDto = {
                predicted: {
                    interval: { lower: 25, upper: 95, confidence: 80 },
                    iqr: { lower: 32, upper: 71, confidence: 50 },
                    hardRange: { lower: 12, upper: 145, confidence: 100 },
                    pointEstimate: 47.5,
                    n: 18,
                },
                layerDistribution: AQUIFER_LAYERS.map((l) => ({
                    id: l.id,
                    label: l.label,
                    count: 0,
                    pct: 0,
                })),
                nNeighbors: 18,
                medianDistKm: 4.7,
                intakeType: 'well',
                radiusKm: 50,
                insufficientData: false,
                timeTakenMs: 47,
                cached: false,
            };
            redis.get.mockResolvedValueOnce(JSON.stringify(cached));

            const res = await service.predict(buildDto({ intakeType: 'well' }));

            expect(res.cached).toBe(true);
            expect(res.nNeighbors).toBe(18);
            expect(res.predicted!.pointEstimate).toBe(47.5);
            expect(prisma.$queryRaw).not.toHaveBeenCalled();
        });

        it('cache miss: SQL вызывается + redis.set с TTL=DEPTH_PREDICT_CACHE_TTL_SECONDS (300), mode=EX', async () => {
            redis.get.mockResolvedValueOnce(null);
            prisma.$queryRaw.mockResolvedValueOnce([buildRow()]);

            await service.predict(buildDto());
            // Дать tryCacheSet шанс выполниться (fire-and-forget).
            await new Promise((r) => setImmediate(r));

            expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
            expect(redis.set).toHaveBeenCalledTimes(1);
            const [key, value, mode, ttl] = redis.set.mock.calls[0] as [
                string,
                string,
                string,
                number,
            ];
            expect(key).toMatch(/^depth-predict:/);
            expect(typeof value).toBe('string');
            expect(mode).toBe('EX');
            expect(ttl).toBe(DEPTH_PREDICT_CACHE_TTL_SECONDS);
        });

        it('Redis GET error → fall through to SQL без падения', async () => {
            redis.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
            prisma.$queryRaw.mockResolvedValueOnce([buildRow()]);

            const res = await service.predict(buildDto());

            expect(res.cached).toBe(false);
            expect(res.nNeighbors).toBe(1);
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
    // Response shape — все required поля + intakeType/radiusKm echo
    // -----------------------------------------------------------------------

    describe('response shape', () => {
        it('содержит все required поля + intakeType + radiusKm echo', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([buildRow({ depth: 30 }), buildRow({ depth: 35 })]);
            const res = await service.predict(buildDto({ intakeType: 'well_dug', radiusKm: 25 }));

            expect(res).toEqual(
                expect.objectContaining({
                    predicted: expect.any(Object),
                    layerDistribution: expect.any(Array),
                    nNeighbors: expect.any(Number),
                    medianDistKm: expect.any(Number),
                    intakeType: 'well_dug',
                    radiusKm: 25,
                    insufficientData: expect.any(Boolean),
                    timeTakenMs: expect.any(Number),
                    cached: expect.any(Boolean),
                }),
            );
            expect(res.timeTakenMs).toBeGreaterThanOrEqual(0);
            expect(res.layerDistribution).toHaveLength(5);
        });

        it('predicted shape — interval/iqr/hardRange/pointEstimate/n при наличии соседей', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ depth: 20 }),
                buildRow({ depth: 30 }),
                buildRow({ depth: 40 }),
            ]);
            const res = await service.predict(buildDto());

            expect(res.predicted).toEqual(
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
                    n: 3,
                }),
            );
            expect(res.cached).toBe(false);
            expect(res.insufficientData).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // roundTo (1 знак для глубин)
    // -----------------------------------------------------------------------

    describe('roundTo (1 digit для depth)', () => {
        it('pointEstimate округляется до 1 знака (12.345 → 12.3)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ depth: 12.345, dist_km: 1, sample_date: new Date('2026-05-01') }),
            ]);
            const res = await service.predict(buildDto());
            expect(res.predicted!.pointEstimate).toBe(12.3);
            expect(res.predicted!.hardRange.lower).toBe(12.3);
            expect(res.predicted!.hardRange.upper).toBe(12.3);
        });
    });
});
