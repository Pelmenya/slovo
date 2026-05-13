import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '@slovo/database';
import {
    GRID_DEFAULT_DEG,
    HEATMAP_CACHE_TTL_SECONDS,
    HEATMAP_REDIS_TOKEN,
    type THeatmapParam,
} from '../water-analysis.constants';
import type { HeatmapQueryDto } from './dto/heatmap.request.dto';
import type { HeatmapResponseDto } from './dto/heatmap.response.dto';
import { HeatmapService } from './heatmap.service';

// =============================================================================
// HeatmapService unit-тесты — мокаем Prisma.$queryRaw + Redis (get/set),
// проверяем все ветки: validateBbox / resolvePdk / statusFor / mapRowsToFeatures
// / cache hit/miss / Redis error fall-through.
//
// Real PostgreSQL + Redis НЕ нужны (e2e под отдельный testcontainer setup).
// =============================================================================

type TRawRow = {
    cell_lon: number;
    cell_lat: number;
    count: number;
    mean: number;
    median: number;
    p75: number;
    exceeds_count: number;
};

type TPrismaMock = {
    $queryRaw: jest.Mock;
};

type TRedisMock = {
    get: jest.Mock;
    set: jest.Mock;
};

describe('HeatmapService', () => {
    let service: HeatmapService;
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
                HeatmapService,
                { provide: PrismaService, useValue: prisma },
                { provide: HEATMAP_REDIS_TOKEN, useValue: redis },
            ],
        }).compile();
        service = moduleRef.get(HeatmapService);
    }

    function buildDto(overrides: Partial<HeatmapQueryDto> = {}): HeatmapQueryDto {
        return {
            param: overrides.param ?? ('iron_total' satisfies THeatmapParam),
            west: overrides.west ?? 36.5,
            south: overrides.south ?? 54.8,
            east: overrides.east ?? 39.0,
            north: overrides.north ?? 56.5,
            grid: overrides.grid,
        } as HeatmapQueryDto;
    }

    function buildRow(overrides: Partial<TRawRow> = {}): TRawRow {
        return {
            cell_lon: 37.625,
            cell_lat: 55.755,
            count: 10,
            mean: 0.42,
            median: 0.31,
            p75: 0.65,
            exceeds_count: 5,
            ...overrides,
        };
    }

    beforeEach(async () => {
        await setupService();
    });

    // -----------------------------------------------------------------------
    // validateBbox
    // -----------------------------------------------------------------------

    describe('validateBbox', () => {
        it('400 — west >= east (нулевой / обратный диапазон долгот)', async () => {
            await expect(
                service.query(buildDto({ west: 40, east: 40 })),
            ).rejects.toThrow(BadRequestException);
            await expect(
                service.query(buildDto({ west: 41, east: 40 })),
            ).rejects.toMatchObject({ message: expect.stringMatching(/west.*<.*east/) });
        });

        it('400 — south >= north (нулевой / обратный диапазон широт)', async () => {
            await expect(
                service.query(buildDto({ south: 56, north: 56 })),
            ).rejects.toThrow(BadRequestException);
            await expect(
                service.query(buildDto({ south: 60, north: 55 })),
            ).rejects.toMatchObject({ message: expect.stringMatching(/south.*<.*north/) });
        });

        it('400 — bbox слишком большой по долготе (>60°)', async () => {
            await expect(
                service.query(buildDto({ west: -30, east: 40, south: 50, north: 55 })),
            ).rejects.toMatchObject({
                status: 400,
                message: expect.stringMatching(/слишком большой/),
            });
        });

        it('400 — bbox слишком большой по широте (>30°)', async () => {
            await expect(
                service.query(buildDto({ west: 36, east: 40, south: 30, north: 65 })),
            ).rejects.toMatchObject({
                status: 400,
                message: expect.stringMatching(/слишком большой/),
            });
        });

        it('пропускает валидный МО bbox (~3° × 2°)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            await expect(service.query(buildDto())).resolves.toBeDefined();
        });
    });

    // -----------------------------------------------------------------------
    // resolvePdk + statusFor (через query → response.pdk + features.status)
    // -----------------------------------------------------------------------

    describe('resolvePdk + statusFor (single-type, iron_total pdk=0.3)', () => {
        it('возвращает displayValue=0.3 для iron_total', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.query(buildDto({ param: 'iron_total' }));
            expect(res.pdk).toBe(0.3);
        });

        it('status=good при median ≤ pdk (0.15 ≤ 0.3)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([buildRow({ median: 0.15 })]);
            const res = await service.query(buildDto({ param: 'iron_total' }));
            expect(res.features[0].properties.status).toBe('good');
        });

        it('status=mid при median между pdk и 2×pdk (0.45 / 0.3 = 1.5)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([buildRow({ median: 0.45 })]);
            const res = await service.query(buildDto({ param: 'iron_total' }));
            expect(res.features[0].properties.status).toBe('mid');
        });

        it('status=bad при median > 2×pdk (0.9 / 0.3 = 3)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([buildRow({ median: 0.9 })]);
            const res = await service.query(buildDto({ param: 'iron_total' }));
            expect(res.features[0].properties.status).toBe('bad');
        });
    });

    describe('resolvePdk + statusFor (range-type, ph min=6 max=9)', () => {
        it('displayValue=9 (верхняя граница range)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.query(buildDto({ param: 'ph' }));
            expect(res.pdk).toBe(9);
        });

        it('status=good при median внутри [6, 9]', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([buildRow({ median: 7.2 })]);
            const res = await service.query(buildDto({ param: 'ph' }));
            expect(res.features[0].properties.status).toBe('good');
        });

        it('status=bad при median ниже min (5.5 < 6)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([buildRow({ median: 5.5 })]);
            const res = await service.query(buildDto({ param: 'ph' }));
            expect(res.features[0].properties.status).toBe('bad');
        });

        it('status=bad при median выше max (9.5 > 9)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([buildRow({ median: 9.5 })]);
            const res = await service.query(buildDto({ param: 'ph' }));
            expect(res.features[0].properties.status).toBe('bad');
        });
    });

    describe('resolvePdk + statusFor (none-type, temperature/electrical_conductivity)', () => {
        it('temperature: displayValue=0 (не нормируется)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.query(buildDto({ param: 'temperature' }));
            expect(res.pdk).toBe(0);
        });

        it('electrical_conductivity: status=good для любой median (нет норматива)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ median: 1500 }),
                buildRow({ median: 5000, cell_lon: 38, cell_lat: 56 }),
            ]);
            const res = await service.query(buildDto({ param: 'electrical_conductivity' }));
            expect(res.features.map((f) => f.properties.status)).toEqual(['good', 'good']);
        });
    });

    describe('resolvePdk + statusFor (risk synthetic 0-100)', () => {
        it('displayValue=50 (synthetic threshold)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.query(buildDto({ param: 'risk' }));
            expect(res.pdk).toBe(50);
        });

        it('status=good при risk < 50', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([buildRow({ median: 30 })]);
            const res = await service.query(buildDto({ param: 'risk' }));
            expect(res.features[0].properties.status).toBe('good');
        });

        it('status=mid при 50 ≤ risk < 80', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([buildRow({ median: 65 })]);
            const res = await service.query(buildDto({ param: 'risk' }));
            expect(res.features[0].properties.status).toBe('mid');
        });

        it('status=bad при risk ≥ 80', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([buildRow({ median: 85 })]);
            const res = await service.query(buildDto({ param: 'risk' }));
            expect(res.features[0].properties.status).toBe('bad');
        });

        it('boundary: median=50 → mid (не good)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([buildRow({ median: 50 })]);
            const res = await service.query(buildDto({ param: 'risk' }));
            expect(res.features[0].properties.status).toBe('mid');
        });

        it('boundary: median=80 → bad (не mid)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([buildRow({ median: 80 })]);
            const res = await service.query(buildDto({ param: 'risk' }));
            expect(res.features[0].properties.status).toBe('bad');
        });
    });

    // -----------------------------------------------------------------------
    // resolvePdk + statusFor (all_problems composite)
    //
    // composite — synthetic param: % rows в cell где хотя бы один regulated
    // paramу превышает ПДК. Median = AVG(has_exceedance × 100) = exceedsPct.
    // statusFor берёт exceedsPct (не median) для composite — % rows с проблемой:
    //   < 30% → good (здоровый район)
    //   30-60% → mid (смешанный)
    //   ≥ 60% → bad (массовая проблема)
    // -----------------------------------------------------------------------

    describe('resolvePdk + statusFor (all_problems composite)', () => {
        it('displayValue=30 (mid threshold для UI legend)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.query(buildDto({ param: 'all_problems' }));
            expect(res.pdk).toBe(30);
        });

        it('status=good при exceedsPct < 30 (10/100 = 10%)', async () => {
            // mean/median/p75 для composite = exceedsPct (binary aggregation).
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ count: 100, exceeds_count: 10, mean: 10, median: 10, p75: 10 }),
            ]);
            const res = await service.query(buildDto({ param: 'all_problems' }));
            expect(res.features[0].properties.status).toBe('good');
            expect(res.features[0].properties.exceedsPct).toBe(10);
        });

        it('status=mid при 30 ≤ exceedsPct < 60 (45/100 = 45%)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ count: 100, exceeds_count: 45, mean: 45, median: 45, p75: 45 }),
            ]);
            const res = await service.query(buildDto({ param: 'all_problems' }));
            expect(res.features[0].properties.status).toBe('mid');
        });

        it('status=bad при exceedsPct ≥ 60 (75/100 = 75%)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ count: 100, exceeds_count: 75, mean: 75, median: 75, p75: 75 }),
            ]);
            const res = await service.query(buildDto({ param: 'all_problems' }));
            expect(res.features[0].properties.status).toBe('bad');
        });

        it('boundary: exceedsPct=30 → mid (не good)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ count: 100, exceeds_count: 30, median: 30 }),
            ]);
            const res = await service.query(buildDto({ param: 'all_problems' }));
            expect(res.features[0].properties.status).toBe('mid');
        });

        it('boundary: exceedsPct=60 → bad (не mid)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ count: 100, exceeds_count: 60, median: 60 }),
            ]);
            const res = await service.query(buildDto({ param: 'all_problems' }));
            expect(res.features[0].properties.status).toBe('bad');
        });

        it('пустой rows → empty FeatureCollection', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.query(buildDto({ param: 'all_problems' }));
            expect(res.type).toBe('FeatureCollection');
            expect(res.features).toEqual([]);
            expect(res.param).toBe('all_problems');
        });
    });

    // -----------------------------------------------------------------------
    // resolvePdk + statusFor (coverage density)
    //
    // density — synthetic param: dataset coverage без ПДК-фильтра. mean/median/p75
    // = count. statusFor берёт median (=count) с count thresholds:
    //   < 5 → good (sparse)
    //   < 15 → mid (medium)
    //   ≥ 15 → bad (dense)
    // На фронте «bad» в grey-scale = «много данных», семантически OK.
    // -----------------------------------------------------------------------

    describe('resolvePdk + statusFor (coverage density)', () => {
        it('displayValue=15 (dense threshold для UI legend)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.query(buildDto({ param: 'coverage' }));
            expect(res.pdk).toBe(15);
        });

        it('status=good при count < 5 (sparse, 3 анализа в cell)', async () => {
            // Для coverage mean/median/p75 = count (binary aggregation в SQL).
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ count: 3, mean: 3, median: 3, p75: 3, exceeds_count: 0 }),
            ]);
            const res = await service.query(buildDto({ param: 'coverage' }));
            expect(res.features[0].properties.status).toBe('good');
        });

        it('status=mid при 5 ≤ count < 15 (medium, 10 анализов)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ count: 10, mean: 10, median: 10, p75: 10, exceeds_count: 0 }),
            ]);
            const res = await service.query(buildDto({ param: 'coverage' }));
            expect(res.features[0].properties.status).toBe('mid');
        });

        it('status=bad при count ≥ 15 (dense, 20 анализов)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ count: 20, mean: 20, median: 20, p75: 20, exceeds_count: 0 }),
            ]);
            const res = await service.query(buildDto({ param: 'coverage' }));
            expect(res.features[0].properties.status).toBe('bad');
        });

        it('boundary: count=5 → mid (не good)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ count: 5, mean: 5, median: 5, p75: 5, exceeds_count: 0 }),
            ]);
            const res = await service.query(buildDto({ param: 'coverage' }));
            expect(res.features[0].properties.status).toBe('mid');
        });

        it('boundary: count=15 → bad (не mid)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ count: 15, mean: 15, median: 15, p75: 15, exceeds_count: 0 }),
            ]);
            const res = await service.query(buildDto({ param: 'coverage' }));
            expect(res.features[0].properties.status).toBe('bad');
        });

        it('exceedsPct=0 для coverage (нет concept «exceedance»)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ count: 50, mean: 50, median: 50, p75: 50, exceeds_count: 0 }),
            ]);
            const res = await service.query(buildDto({ param: 'coverage' }));
            expect(res.features[0].properties.exceedsPct).toBe(0);
            expect(res.features[0].properties.count).toBe(50);
        });

        it('пустой rows → empty FeatureCollection', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.query(buildDto({ param: 'coverage' }));
            expect(res.type).toBe('FeatureCollection');
            expect(res.features).toEqual([]);
            expect(res.param).toBe('coverage');
        });
    });

    // -----------------------------------------------------------------------
    // mapRowsToFeatures — GeoJSON shape, exceedsPct, rounding
    // -----------------------------------------------------------------------

    describe('mapRowsToFeatures', () => {
        it('возвращает FeatureCollection с одной Feature на row', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ cell_lon: 37.625, cell_lat: 55.755 }),
                buildRow({ cell_lon: 38.025, cell_lat: 56.155, count: 5, exceeds_count: 0 }),
            ]);
            const res = await service.query(buildDto({ param: 'iron_total' }));

            expect(res.type).toBe('FeatureCollection');
            expect(res.features).toHaveLength(2);
            expect(res.features[0].type).toBe('Feature');
            expect(res.features[0].geometry).toEqual({
                type: 'Point',
                coordinates: [37.625, 55.755],
            });
            expect(res.features[0].properties.param).toBe('iron_total');
        });

        it('exceedsPct = round(exceeds_count / count × 100)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ count: 23, exceeds_count: 12 }), // 12/23 = 52.17 → 52
                buildRow({ count: 100, exceeds_count: 33, cell_lat: 56 }), // 33%
                buildRow({ count: 7, exceeds_count: 0, cell_lat: 57 }), // 0%
            ]);
            const res = await service.query(buildDto({ param: 'iron_total' }));
            expect(res.features.map((f) => f.properties.exceedsPct)).toEqual([52, 33, 0]);
        });

        it('exceedsPct = 0 при count = 0 (защита от div-by-zero)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ count: 0, exceeds_count: 0, mean: 0, median: 0, p75: 0 }),
            ]);
            const res = await service.query(buildDto({ param: 'iron_total' }));
            expect(res.features[0].properties.exceedsPct).toBe(0);
        });

        it('mean/median/p75 округляются до 4 знаков', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({
                    mean: 0.123456789,
                    median: 0.987654321,
                    p75: 1.555555555,
                }),
            ]);
            const res = await service.query(buildDto({ param: 'iron_total' }));
            const props = res.features[0].properties;
            expect(props.mean).toBe(0.1235);
            expect(props.median).toBe(0.9877);
            expect(props.p75).toBe(1.5556);
        });

        it('пустой rows → features=[]; cached=false; type=FeatureCollection', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.query(buildDto({ param: 'iron_total' }));
            expect(res.features).toEqual([]);
            expect(res.cached).toBe(false);
            expect(res.type).toBe('FeatureCollection');
        });
    });

    // -----------------------------------------------------------------------
    // Response shape
    // -----------------------------------------------------------------------

    describe('response shape', () => {
        it('echo param + grid + cached=false при cache miss', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.query(buildDto({ param: 'manganese', grid: 0.1 }));
            expect(res.param).toBe('manganese');
            expect(res.grid).toBe(0.1);
            expect(res.cached).toBe(false);
            expect(typeof res.timeTakenMs).toBe('number');
            expect(res.timeTakenMs).toBeGreaterThanOrEqual(0);
        });

        it('grid default = GRID_DEFAULT_DEG (0.05) когда не задан', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.query(buildDto({ grid: undefined }));
            expect(res.grid).toBe(GRID_DEFAULT_DEG);
        });
    });

    // -----------------------------------------------------------------------
    // buildCacheKey — стабильный ключ
    // -----------------------------------------------------------------------

    describe('cache key', () => {
        it('cache.get вызывается с детерминированным ключом включающим все параметры', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            await service.query(buildDto({
                param: 'iron_total',
                west: 36.5,
                south: 54.8,
                east: 39.0,
                north: 56.5,
                grid: 0.05,
            }));
            expect(redis.get).toHaveBeenCalledWith(
                'heatmap:v3:iron_total:36.5000:54.8000:39.0000:56.5000:0.0500',
            );
        });

        it('одинаковый bbox + param → один и тот же cache-key (между вызовами)', async () => {
            prisma.$queryRaw.mockResolvedValue([]);
            await service.query(buildDto());
            await service.query(buildDto());
            const keys = redis.get.mock.calls.map((call) => call[0] as string);
            expect(keys[0]).toBe(keys[1]);
        });

        it('разные параметры → разные cache-keys', async () => {
            prisma.$queryRaw.mockResolvedValue([]);
            await service.query(buildDto({ param: 'iron_total' }));
            await service.query(buildDto({ param: 'manganese' }));
            const keys = redis.get.mock.calls.map((call) => call[0] as string);
            expect(keys[0]).not.toBe(keys[1]);
            expect(keys[0]).toMatch(/iron_total/);
            expect(keys[1]).toMatch(/manganese/);
        });
    });

    // -----------------------------------------------------------------------
    // Cache hit / miss / errors
    // -----------------------------------------------------------------------

    describe('cache behaviour', () => {
        it('cache hit: redis.get → valid JSON → response.cached=true, нет SQL', async () => {
            const cached: HeatmapResponseDto = {
                type: 'FeatureCollection',
                features: [],
                param: 'iron_total',
                pdk: 0.3,
                grid: 0.05,
                timeTakenMs: 42,
                cached: false, // в cache мы пишем cached=false, при HIT — переписываем на true
            };
            redis.get.mockResolvedValueOnce(JSON.stringify(cached));

            const res = await service.query(buildDto({ param: 'iron_total' }));

            expect(res.cached).toBe(true);
            expect(res.features).toEqual([]);
            expect(res.pdk).toBe(0.3);
            // SQL не должен дёргаться
            expect(prisma.$queryRaw).not.toHaveBeenCalled();
        });

        it('cache miss: SQL вызывается + redis.set с TTL = HEATMAP_CACHE_TTL_SECONDS', async () => {
            redis.get.mockResolvedValueOnce(null);
            prisma.$queryRaw.mockResolvedValueOnce([buildRow()]);

            await service.query(buildDto({ param: 'iron_total' }));

            // Дать промису tryCacheSet шанс выполниться
            await new Promise((r) => setImmediate(r));

            expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
            expect(redis.set).toHaveBeenCalledTimes(1);
            const [key, value, mode, ttl] = redis.set.mock.calls[0] as [
                string,
                string,
                string,
                number,
            ];
            expect(key).toMatch(/^heatmap:v\d+:iron_total:/);
            expect(typeof value).toBe('string');
            expect(mode).toBe('EX');
            expect(ttl).toBe(HEATMAP_CACHE_TTL_SECONDS);
        });

        it('Redis GET error → fall through to SQL без падения (cache.get throws)', async () => {
            redis.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
            prisma.$queryRaw.mockResolvedValueOnce([buildRow()]);

            const res = await service.query(buildDto({ param: 'iron_total' }));

            expect(res.cached).toBe(false);
            expect(res.features).toHaveLength(1);
            expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
        });

        it('Redis GET вернул битый JSON → fall through to SQL (JSON.parse throws)', async () => {
            redis.get.mockResolvedValueOnce('not-a-valid-json{{{');
            prisma.$queryRaw.mockResolvedValueOnce([]);

            const res = await service.query(buildDto({ param: 'iron_total' }));

            expect(res.cached).toBe(false);
            expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
        });

        it('Redis SET error → response отдаётся успешно (fail-soft)', async () => {
            redis.get.mockResolvedValueOnce(null);
            redis.set.mockRejectedValueOnce(new Error('ECONNREFUSED'));
            prisma.$queryRaw.mockResolvedValueOnce([buildRow()]);

            // Не должно бросать, тест pass = no unhandled promise rejection
            const res = await service.query(buildDto({ param: 'iron_total' }));
            await new Promise((r) => setImmediate(r));

            expect(res.cached).toBe(false);
            expect(res.features).toHaveLength(1);
        });
    });

    // -----------------------------------------------------------------------
    // Risk vs param query routing
    // -----------------------------------------------------------------------

    describe('SQL routing', () => {
        it('param=risk → одна Prisma.$queryRaw вызовется (risk-branch)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            await service.query(buildDto({ param: 'risk' }));
            expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
        });

        it('param=iron_total → одна Prisma.$queryRaw вызовется (param-branch)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            await service.query(buildDto({ param: 'iron_total' }));
            expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
        });
    });
});
