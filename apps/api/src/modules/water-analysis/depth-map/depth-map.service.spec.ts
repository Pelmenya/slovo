import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '@slovo/database';
import {
    AQUIFER_LAYERS,
    DEPTH_MAP_CACHE_TTL_SECONDS,
    DEPTH_MAP_REDIS_TOKEN,
    GRID_DEFAULT_DEG,
} from '../water-analysis.constants';
import { DepthMapService } from './depth-map.service';
import type { DepthMapQueryDto } from './dto/depth-map.request.dto';
import type { DepthMapResponseDto } from './dto/depth-map.response.dto';

// =============================================================================
// DepthMapService unit-тесты — мокаем Prisma.$queryRaw + Redis (get/set),
// проверяем все ветки: validateBbox / buildIntakeFilter / mapRowsToFeatures
// (aquiferLayers всегда 5 buckets, dominantLayerId tie-breaker, pctWell, roundTo)
// / buildCacheKey / cache hit/miss / Redis error fall-through.
//
// Real PostgreSQL + PostGIS НЕ нужны (e2e под отдельный testcontainer setup).
// =============================================================================

type TRawRow = {
    cell_lon: number;
    cell_lat: number;
    count: number;
    median: number;
    p25: number;
    p75: number;
    min_depth: number;
    max_depth: number;
    layer_top_water: number;
    layer_sandy: number;
    layer_sandy_limestone: number;
    layer_limestone: number;
    layer_artesian: number;
    well_count: number;
};

type TPrismaMock = {
    $queryRaw: jest.Mock;
};

type TRedisMock = {
    get: jest.Mock;
    set: jest.Mock;
};

describe('DepthMapService', () => {
    let service: DepthMapService;
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
                DepthMapService,
                { provide: PrismaService, useValue: prisma },
                { provide: DEPTH_MAP_REDIS_TOKEN, useValue: redis },
            ],
        }).compile();
        service = moduleRef.get(DepthMapService);
    }

    function buildDto(overrides: Partial<DepthMapQueryDto> = {}): DepthMapQueryDto {
        return {
            intakeType: overrides.intakeType,
            west: overrides.west ?? 36.5,
            south: overrides.south ?? 54.8,
            east: overrides.east ?? 39.0,
            north: overrides.north ?? 56.5,
            grid: overrides.grid,
        } as DepthMapQueryDto;
    }

    function buildRow(overrides: Partial<TRawRow> = {}): TRawRow {
        return {
            cell_lon: 37.625,
            cell_lat: 55.755,
            count: 10,
            median: 35.5,
            p25: 22.0,
            p75: 48.0,
            min_depth: 12.0,
            max_depth: 75.0,
            layer_top_water: 1,
            layer_sandy: 6,
            layer_sandy_limestone: 2,
            layer_limestone: 1,
            layer_artesian: 0,
            well_count: 8,
            ...overrides,
        };
    }

    beforeEach(async () => {
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
    // buildIntakeFilter — через факт что $queryRaw вызвался с разным
    // SQL-template (Prisma.sql внутри). Проверяем что сервис не падает на
    // каждом из трёх вариантов и SQL зовётся ровно 1 раз.
    // -----------------------------------------------------------------------

    describe('buildIntakeFilter — три варианта intakeType', () => {
        it("intakeType='all' (default) — SQL зовётся, response.intakeType='all'", async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.query(buildDto({ intakeType: undefined }));
            expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
            expect(res.intakeType).toBe('all');
        });

        it("intakeType='well' — SQL зовётся, response.intakeType='well'", async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.query(buildDto({ intakeType: 'well' }));
            expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
            expect(res.intakeType).toBe('well');
        });

        it("intakeType='well_dug' — SQL зовётся, response.intakeType='well_dug'", async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.query(buildDto({ intakeType: 'well_dug' }));
            expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
            expect(res.intakeType).toBe('well_dug');
        });

        it("default intakeType='all' echo'ится в response при undefined в DTO", async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.query(buildDto({ intakeType: undefined }));
            expect(res.intakeType).toBe('all');
        });
    });

    // -----------------------------------------------------------------------
    // mapRowsToFeatures
    // -----------------------------------------------------------------------

    describe('mapRowsToFeatures', () => {
        it('пустой rows → features=[]; cached=false; type=FeatureCollection', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.query(buildDto());
            expect(res.features).toEqual([]);
            expect(res.cached).toBe(false);
            expect(res.type).toBe('FeatureCollection');
        });

        it('single row → 1 Feature с корректным shape', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({
                    cell_lon: 37.625,
                    cell_lat: 55.755,
                    count: 10,
                    median: 35.5,
                    p25: 22.0,
                    p75: 48.0,
                    min_depth: 12.0,
                    max_depth: 75.0,
                    well_count: 8,
                }),
            ]);
            const res = await service.query(buildDto());

            expect(res.features).toHaveLength(1);
            const f = res.features[0];
            expect(f.type).toBe('Feature');
            expect(f.geometry).toEqual({ type: 'Point', coordinates: [37.625, 55.755] });
            expect(f.properties.count).toBe(10);
            expect(f.properties.median).toBe(35.5);
            expect(f.properties.p25).toBe(22.0);
            expect(f.properties.p75).toBe(48.0);
            expect(f.properties.minDepth).toBe(12.0);
            expect(f.properties.maxDepth).toBe(75.0);
            expect(f.properties.aquiferLayers).toHaveLength(5);
            expect(typeof f.properties.dominantLayerId).toBe('string');
            expect(typeof f.properties.pctWell).toBe('number');
        });

        it('aquiferLayers всегда 5 buckets — даже при count=0 для пустых слоёв', async () => {
            // Все скважины в одном слое (sandy), остальные 4 имеют count=0.
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({
                    count: 5,
                    layer_top_water: 0,
                    layer_sandy: 5,
                    layer_sandy_limestone: 0,
                    layer_limestone: 0,
                    layer_artesian: 0,
                }),
            ]);
            const res = await service.query(buildDto());

            const layers = res.features[0].properties.aquiferLayers;
            expect(layers).toHaveLength(5);

            // Порядок и ids стабильные — те же что в AQUIFER_LAYERS.
            const ids = layers.map((l) => l.id);
            expect(ids).toEqual(AQUIFER_LAYERS.map((l) => l.id));

            // Counts совпадают с raw.
            const counts = layers.map((l) => l.count);
            expect(counts).toEqual([0, 5, 0, 0, 0]);
        });

        it('aquiferLayers labels берутся из AQUIFER_LAYERS (русские названия с диапазонами)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([buildRow()]);
            const res = await service.query(buildDto());
            const labels = res.features[0].properties.aquiferLayers.map((l) => l.label);
            expect(labels).toEqual(AQUIFER_LAYERS.map((l) => l.label));
        });

        it('dominantLayerId — id с максимальным count', async () => {
            // sandy_limestone лидер с 10, остальные меньше.
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({
                    count: 16,
                    layer_top_water: 1,
                    layer_sandy: 3,
                    layer_sandy_limestone: 10,
                    layer_limestone: 2,
                    layer_artesian: 0,
                }),
            ]);
            const res = await service.query(buildDto());
            expect(res.features[0].properties.dominantLayerId).toBe('sandy_limestone');
        });

        it('dominantLayerId tie-breaker — порядок AQUIFER_LAYERS (top_water первый)', async () => {
            // top_water=2 и sandy=2 ровно одинаковые → top_water выигрывает (первый в массиве).
            // reduce использует `>` (не `>=`), значит при равенстве остаётся текущий best.
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({
                    count: 4,
                    layer_top_water: 2,
                    layer_sandy: 2,
                    layer_sandy_limestone: 0,
                    layer_limestone: 0,
                    layer_artesian: 0,
                }),
            ]);
            const res = await service.query(buildDto());
            expect(res.features[0].properties.dominantLayerId).toBe('top_water');
        });

        it('pct в каждом layer = round(count / total × 100)', async () => {
            // count=10: top_water=1 (10%), sandy=6 (60%), sandy_limestone=2 (20%),
            // limestone=1 (10%), artesian=0 (0%).
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({
                    count: 10,
                    layer_top_water: 1,
                    layer_sandy: 6,
                    layer_sandy_limestone: 2,
                    layer_limestone: 1,
                    layer_artesian: 0,
                }),
            ]);
            const res = await service.query(buildDto());
            const pcts = res.features[0].properties.aquiferLayers.map((l) => l.pct);
            expect(pcts).toEqual([10, 60, 20, 10, 0]);
        });

        it('pct округляется до целого (12/23 = 52.17 → 52)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({
                    count: 23,
                    layer_top_water: 0,
                    layer_sandy: 12,
                    layer_sandy_limestone: 11,
                    layer_limestone: 0,
                    layer_artesian: 0,
                }),
            ]);
            const res = await service.query(buildDto());
            const pcts = res.features[0].properties.aquiferLayers.map((l) => l.pct);
            // 12/23=52.17→52, 11/23=47.83→48.
            expect(pcts[1]).toBe(52);
            expect(pcts[2]).toBe(48);
        });

        it('pct=0 для всех слоёв при count=0 (защита от div-by-zero)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({
                    count: 0,
                    layer_top_water: 0,
                    layer_sandy: 0,
                    layer_sandy_limestone: 0,
                    layer_limestone: 0,
                    layer_artesian: 0,
                    well_count: 0,
                }),
            ]);
            const res = await service.query(buildDto());
            const pcts = res.features[0].properties.aquiferLayers.map((l) => l.pct);
            expect(pcts).toEqual([0, 0, 0, 0, 0]);
            expect(res.features[0].properties.pctWell).toBe(0);
        });

        it('pctWell = round(well_count / count × 100)', async () => {
            // well_count=8, count=10 → 80%.
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ count: 10, well_count: 8 }),
            ]);
            const res = await service.query(buildDto());
            expect(res.features[0].properties.pctWell).toBe(80);
        });

        it('pctWell=100 — все скважины (well_count=count)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ count: 15, well_count: 15 }),
            ]);
            const res = await service.query(buildDto());
            expect(res.features[0].properties.pctWell).toBe(100);
        });

        it('pctWell=0 — все колодцы (well_count=0)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ count: 5, well_count: 0 }),
            ]);
            const res = await service.query(buildDto());
            expect(res.features[0].properties.pctWell).toBe(0);
        });

        it('roundTo — minDepth=12.345 → 12.3 (1 знак)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({
                    median: 35.567,
                    p25: 22.123,
                    p75: 48.789,
                    min_depth: 12.345,
                    max_depth: 75.654,
                }),
            ]);
            const res = await service.query(buildDto());
            const props = res.features[0].properties;
            expect(props.median).toBe(35.6);
            expect(props.p25).toBe(22.1);
            expect(props.p75).toBe(48.8);
            expect(props.minDepth).toBe(12.3);
            expect(props.maxDepth).toBe(75.7);
        });

        it('две Feature на два row — корректный порядок и независимые properties', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({
                    cell_lon: 37.0,
                    cell_lat: 55.0,
                    count: 4,
                    layer_top_water: 4,
                    layer_sandy: 0,
                    layer_sandy_limestone: 0,
                    layer_limestone: 0,
                    layer_artesian: 0,
                    well_count: 0,
                }),
                buildRow({
                    cell_lon: 38.0,
                    cell_lat: 56.0,
                    count: 6,
                    layer_top_water: 0,
                    layer_sandy: 0,
                    layer_sandy_limestone: 0,
                    layer_limestone: 0,
                    layer_artesian: 6,
                    well_count: 6,
                }),
            ]);
            const res = await service.query(buildDto());

            expect(res.features).toHaveLength(2);
            expect(res.features[0].geometry.coordinates).toEqual([37.0, 55.0]);
            expect(res.features[0].properties.dominantLayerId).toBe('top_water');
            expect(res.features[0].properties.pctWell).toBe(0);
            expect(res.features[1].geometry.coordinates).toEqual([38.0, 56.0]);
            expect(res.features[1].properties.dominantLayerId).toBe('artesian');
            expect(res.features[1].properties.pctWell).toBe(100);
        });
    });

    // -----------------------------------------------------------------------
    // Response shape
    // -----------------------------------------------------------------------

    describe('response shape', () => {
        it('echo intakeType + grid + cached=false при cache miss', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.query(buildDto({ intakeType: 'well', grid: 0.1 }));
            expect(res.intakeType).toBe('well');
            expect(res.grid).toBe(0.1);
            expect(res.cached).toBe(false);
            expect(res.type).toBe('FeatureCollection');
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
            await service.query(
                buildDto({
                    intakeType: 'well',
                    west: 36.5,
                    south: 54.8,
                    east: 39.0,
                    north: 56.5,
                    grid: 0.05,
                }),
            );
            expect(redis.get).toHaveBeenCalledWith(
                'depth-map:v4:well:36.5000:54.8000:39.0000:56.5000:0.0500',
            );
        });

        it('одинаковые params → одинаковый cache-key (идемпотентность)', async () => {
            prisma.$queryRaw.mockResolvedValue([]);
            await service.query(buildDto());
            await service.query(buildDto());
            const keys = redis.get.mock.calls.map((call) => call[0] as string);
            expect(keys[0]).toBe(keys[1]);
        });

        it('разные intakeType при том же bbox → разные cache-keys (изоляция фильтра)', async () => {
            prisma.$queryRaw.mockResolvedValue([]);
            await service.query(buildDto({ intakeType: 'all' }));
            await service.query(buildDto({ intakeType: 'well' }));
            await service.query(buildDto({ intakeType: 'well_dug' }));
            const keys = redis.get.mock.calls.map((call) => call[0] as string);
            expect(new Set(keys).size).toBe(3);
            expect(keys[0]).toMatch(/depth-map:v\d+:all:/);
            expect(keys[1]).toMatch(/depth-map:v\d+:well:/);
            expect(keys[2]).toMatch(/depth-map:v\d+:well_dug:/);
        });

        it('разные bbox → разные cache-keys', async () => {
            prisma.$queryRaw.mockResolvedValue([]);
            await service.query(buildDto({ west: 36.5 }));
            await service.query(buildDto({ west: 37.0 }));
            const keys = redis.get.mock.calls.map((call) => call[0] as string);
            expect(keys[0]).not.toBe(keys[1]);
        });

        it('разные grid → разные cache-keys', async () => {
            prisma.$queryRaw.mockResolvedValue([]);
            await service.query(buildDto({ grid: 0.05 }));
            await service.query(buildDto({ grid: 0.1 }));
            const keys = redis.get.mock.calls.map((call) => call[0] as string);
            expect(keys[0]).not.toBe(keys[1]);
        });
    });

    // -----------------------------------------------------------------------
    // Cache hit / miss / errors
    // -----------------------------------------------------------------------

    describe('cache behaviour', () => {
        it('cache hit: redis.get → valid JSON → response.cached=true, нет SQL', async () => {
            const cached: DepthMapResponseDto = {
                type: 'FeatureCollection',
                features: [],
                intakeType: 'all',
                grid: 0.05,
                timeTakenMs: 42,
                cached: false, // в cache мы пишем cached=false, при HIT — переписываем на true
            };
            redis.get.mockResolvedValueOnce(JSON.stringify(cached));

            const res = await service.query(buildDto());

            expect(res.cached).toBe(true);
            expect(res.features).toEqual([]);
            expect(res.intakeType).toBe('all');
            expect(prisma.$queryRaw).not.toHaveBeenCalled();
        });

        it('cache miss: SQL вызывается + redis.set с TTL = DEPTH_MAP_CACHE_TTL_SECONDS (86400)', async () => {
            redis.get.mockResolvedValueOnce(null);
            prisma.$queryRaw.mockResolvedValueOnce([buildRow()]);

            await service.query(buildDto({ intakeType: 'well' }));

            // Дать промису tryCacheSet шанс выполниться (fire-and-forget).
            await new Promise((r) => setImmediate(r));

            expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
            expect(redis.set).toHaveBeenCalledTimes(1);
            const [key, value, mode, ttl] = redis.set.mock.calls[0] as [
                string,
                string,
                string,
                number,
            ];
            expect(key).toMatch(/^depth-map:v\d+:well:/);
            expect(typeof value).toBe('string');
            expect(mode).toBe('EX');
            expect(ttl).toBe(DEPTH_MAP_CACHE_TTL_SECONDS);
        });

        it('Redis GET error → fall through to SQL без падения', async () => {
            redis.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
            prisma.$queryRaw.mockResolvedValueOnce([buildRow()]);

            const res = await service.query(buildDto());

            expect(res.cached).toBe(false);
            expect(res.features).toHaveLength(1);
            expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
        });

        it('Redis GET вернул битый JSON → fall through to SQL (JSON.parse throws)', async () => {
            redis.get.mockResolvedValueOnce('not-a-valid-json{{{');
            prisma.$queryRaw.mockResolvedValueOnce([]);

            const res = await service.query(buildDto());

            expect(res.cached).toBe(false);
            expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
        });

        it('Redis SET error → response отдаётся успешно (fail-soft)', async () => {
            redis.get.mockResolvedValueOnce(null);
            redis.set.mockRejectedValueOnce(new Error('ECONNREFUSED'));
            prisma.$queryRaw.mockResolvedValueOnce([buildRow()]);

            // Не должно бросать, тест pass = no unhandled promise rejection.
            const res = await service.query(buildDto());
            await new Promise((r) => setImmediate(r));

            expect(res.cached).toBe(false);
            expect(res.features).toHaveLength(1);
        });
    });
});
