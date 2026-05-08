import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '@slovo/database';
import {
    AQUIFER_LAYERS,
    AQUIFER_STATS_CACHE_TTL_SECONDS,
    AQUIFER_STATS_REDIS_TOKEN,
} from '../water-analysis.constants';
import type { TIntakeTypeFilter } from '../_shared';
import { AquiferStatsService } from './aquifer-stats.service';
import type { AquiferStatsQueryDto } from './dto/aquifer-stats.request.dto';
import type { AquiferStatsResponseDto } from './dto/aquifer-stats.response.dto';

// =============================================================================
// AquiferStatsService unit-тесты — мокаем Prisma.$queryRaw + Redis.
//
// Покрываем:
//   - validateBbox (5 веток)
//   - aggregateLayers — 5 buckets всегда / count / pct / medianDepth / pctWell
//   - medianChemistry — min 3 sample skip / median linear-interp
//   - Number.isFinite(layer.max) — artesian.max=Infinity → maxDepth=null
//   - computeDominantLayerId — max count / total=0 / tie-breaker
//   - buildIntakeFilter — 3 ветки intakeType
//   - cache hit / miss / Redis error fall-through
//   - buildCacheKey — формат / идемпотентность / разные intakeType / разные bbox
//   - default intakeType='all' echo
//   - response shape (totalWells, samplesUsed, dominantLayerId, intakeType)
//
// Real PostgreSQL + Redis НЕ нужны (e2e под отдельный testcontainer setup).
// =============================================================================

type TRawRow = {
    depth: number;
    intake_type: string;
    params: Record<string, unknown>;
};

type TPrismaMock = {
    $queryRaw: jest.Mock;
};

type TRedisMock = {
    get: jest.Mock;
    set: jest.Mock;
};

describe('AquiferStatsService', () => {
    let service: AquiferStatsService;
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
                AquiferStatsService,
                { provide: PrismaService, useValue: prisma },
                { provide: AQUIFER_STATS_REDIS_TOKEN, useValue: redis },
            ],
        }).compile();
        service = moduleRef.get(AquiferStatsService);
    }

    function buildDto(overrides: Partial<AquiferStatsQueryDto> = {}): AquiferStatsQueryDto {
        return {
            intakeType: overrides.intakeType,
            west: overrides.west ?? 36.5,
            south: overrides.south ?? 54.8,
            east: overrides.east ?? 39.0,
            north: overrides.north ?? 56.5,
        } as AquiferStatsQueryDto;
    }

    function buildRow(overrides: Partial<TRawRow> = {}): TRawRow {
        return {
            depth: 35,
            intake_type: 'well',
            params: {},
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
            await expect(service.query(buildDto({ west: 40, east: 40 }))).rejects.toThrow(
                BadRequestException,
            );
            await expect(
                service.query(buildDto({ west: 41, east: 40 })),
            ).rejects.toMatchObject({ message: expect.stringMatching(/west.*<.*east/) });
        });

        it('400 — south >= north (нулевой / обратный диапазон широт)', async () => {
            await expect(service.query(buildDto({ south: 56, north: 56 }))).rejects.toThrow(
                BadRequestException,
            );
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
    // aggregateLayers — 5 buckets
    // -----------------------------------------------------------------------

    describe('aggregateLayers', () => {
        it('пустой rows → 5 buckets с count=0 / pct=0 / medianChemistry={}', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.query(buildDto());

            expect(res.layers).toHaveLength(5);
            for (const l of res.layers) {
                expect(l.count).toBe(0);
                expect(l.pct).toBe(0);
                expect(l.medianChemistry).toEqual({});
                // medianDepth и pctWell остаются undefined при count=0.
                expect(l.medianDepth).toBeUndefined();
                expect(l.pctWell).toBeUndefined();
            }
            // Порядок и ids стабильные — те же что в AQUIFER_LAYERS.
            expect(res.layers.map((l) => l.id)).toEqual(AQUIFER_LAYERS.map((l) => l.id));
            expect(res.layers.map((l) => l.label)).toEqual(AQUIFER_LAYERS.map((l) => l.label));
        });

        it('всегда 5 buckets даже при count=0 для пустых слоёв', async () => {
            // 3 точки только в sandy (15-50м) — остальные 4 buckets count=0, но всё равно
            // присутствуют в response.
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ depth: 20 }),
                buildRow({ depth: 30 }),
                buildRow({ depth: 45 }),
            ]);
            const res = await service.query(buildDto());

            expect(res.layers).toHaveLength(5);
            const counts = res.layers.map((l) => l.count);
            expect(counts).toEqual([0, 3, 0, 0, 0]);
        });

        it('count корректно распределяет точки по диапазонам (включительно min, исключительно max)', async () => {
            // depth=15 → sandy (min=15), depth=50 → sandy_limestone (min=50),
            // depth=100 → limestone (min=100), depth=200 → artesian (min=200).
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ depth: 0 }), // top_water (0 ≥ 0, < 15)
                buildRow({ depth: 14.99 }), // top_water (< 15)
                buildRow({ depth: 15 }), // sandy (≥ 15, < 50)
                buildRow({ depth: 49.99 }), // sandy
                buildRow({ depth: 50 }), // sandy_limestone (≥ 50, < 100)
                buildRow({ depth: 100 }), // limestone (≥ 100, < 200)
                buildRow({ depth: 200 }), // artesian (≥ 200, < Infinity)
                buildRow({ depth: 500 }), // artesian
            ]);
            const res = await service.query(buildDto());

            const counts = res.layers.map((l) => l.count);
            expect(counts).toEqual([2, 2, 1, 1, 2]);
        });

        it('pct = round(count / total × 100); 12/23 = 52.17 → 52', async () => {
            // 12 точек в sandy, 11 в sandy_limestone, total=23. 12/23=52.17→52, 11/23=47.83→48.
            const rows: TRawRow[] = [];
            for (let i = 0; i < 12; i += 1) rows.push(buildRow({ depth: 30 }));
            for (let i = 0; i < 11; i += 1) rows.push(buildRow({ depth: 70 }));
            prisma.$queryRaw.mockResolvedValueOnce(rows);
            const res = await service.query(buildDto());

            const pcts = res.layers.map((l) => l.pct);
            // [top_water, sandy, sandy_limestone, limestone, artesian].
            expect(pcts).toEqual([0, 52, 48, 0, 0]);
        });

        it('medianDepth — присутствует только при count>0, undefined для пустых buckets', async () => {
            // sandy: 3 точки (20, 30, 45) → median=30. Остальные buckets — пусто.
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ depth: 20 }),
                buildRow({ depth: 30 }),
                buildRow({ depth: 45 }),
            ]);
            const res = await service.query(buildDto());

            const sandy = res.layers.find((l) => l.id === 'sandy');
            expect(sandy?.medianDepth).toBe(30);

            // Все остальные — undefined.
            for (const layer of res.layers) {
                if (layer.id !== 'sandy') {
                    expect(layer.medianDepth).toBeUndefined();
                }
            }
        });

        it('medianDepth округляется до 1 знака (linear interp на чётном кол-ве)', async () => {
            // 4 точки: 20, 25, 35, 45 → median = (25+35)/2 = 30.
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ depth: 20 }),
                buildRow({ depth: 25 }),
                buildRow({ depth: 35 }),
                buildRow({ depth: 45 }),
            ]);
            const res = await service.query(buildDto());

            const sandy = res.layers.find((l) => l.id === 'sandy');
            expect(sandy?.medianDepth).toBe(30);
        });

        it('pctWell = round(wellCount / count × 100), фильтр intake_type==="well"', async () => {
            // 4 wells + 1 well_dug в sandy. pctWell = 4/5 = 80%.
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ depth: 20, intake_type: 'well' }),
                buildRow({ depth: 22, intake_type: 'well' }),
                buildRow({ depth: 30, intake_type: 'well' }),
                buildRow({ depth: 35, intake_type: 'well' }),
                buildRow({ depth: 12, intake_type: 'well_dug' }), // в top_water не в sandy
            ]);
            const res = await service.query(buildDto());

            const sandy = res.layers.find((l) => l.id === 'sandy');
            expect(sandy?.pctWell).toBe(100); // в sandy 4/4 wells

            const topWater = res.layers.find((l) => l.id === 'top_water');
            expect(topWater?.pctWell).toBe(0); // 0/1 wells (всё well_dug)
        });

        it('pctWell корректно считает только intake_type==="well" (не well_dug)', async () => {
            // 2 wells + 2 well_dug в одном bucket. 2/4 = 50%.
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ depth: 20, intake_type: 'well' }),
                buildRow({ depth: 25, intake_type: 'well' }),
                buildRow({ depth: 30, intake_type: 'well_dug' }),
                buildRow({ depth: 35, intake_type: 'well_dug' }),
            ]);
            const res = await service.query(buildDto());

            const sandy = res.layers.find((l) => l.id === 'sandy');
            expect(sandy?.pctWell).toBe(50);
        });
    });

    // -----------------------------------------------------------------------
    // medianChemistry — min 3 sample skip
    // -----------------------------------------------------------------------

    describe('medianChemistry', () => {
        it('paramCode с 2 точками — пропускается (min 3 sample skip)', async () => {
            // sandy: 2 точки имеют iron_total → НЕ должна попасть в medianChemistry.
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ depth: 20, params: { iron_total: 0.3 } }),
                buildRow({ depth: 30, params: { iron_total: 0.5 } }),
            ]);
            const res = await service.query(buildDto());

            const sandy = res.layers.find((l) => l.id === 'sandy');
            expect(sandy?.medianChemistry).toEqual({});
            expect(sandy?.medianChemistry.iron_total).toBeUndefined();
        });

        it('paramCode с 3 точками — попадает в medianChemistry', async () => {
            // sandy: 3 точки с iron_total.
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ depth: 20, params: { iron_total: 0.2 } }),
                buildRow({ depth: 30, params: { iron_total: 0.4 } }),
                buildRow({ depth: 40, params: { iron_total: 0.6 } }),
            ]);
            const res = await service.query(buildDto());

            const sandy = res.layers.find((l) => l.id === 'sandy');
            expect(sandy?.medianChemistry.iron_total).toBe(0.4);
        });

        it('median linear-interp на чётном кол-ве (4 точки)', async () => {
            // 4 точки [0.1, 0.2, 0.3, 0.4] → median = (0.2 + 0.3) / 2 = 0.25.
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ depth: 20, params: { iron_total: 0.1 } }),
                buildRow({ depth: 22, params: { iron_total: 0.2 } }),
                buildRow({ depth: 30, params: { iron_total: 0.3 } }),
                buildRow({ depth: 35, params: { iron_total: 0.4 } }),
            ]);
            const res = await service.query(buildDto());

            const sandy = res.layers.find((l) => l.id === 'sandy');
            expect(sandy?.medianChemistry.iron_total).toBe(0.25);
        });

        it('median округляется до 4 знаков', async () => {
            // 3 точки [0.123456, 0.234567, 0.345678] → median = 0.234567 → 0.2346.
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ depth: 20, params: { iron_total: 0.123456 } }),
                buildRow({ depth: 30, params: { iron_total: 0.234567 } }),
                buildRow({ depth: 40, params: { iron_total: 0.345678 } }),
            ]);
            const res = await service.query(buildDto());

            const sandy = res.layers.find((l) => l.id === 'sandy');
            expect(sandy?.medianChemistry.iron_total).toBe(0.2346);
        });

        it('non-number значения параметров игнорируются (string / null / undefined)', async () => {
            // 3 точки, у одной iron_total=string — в массив для медианы попадут только 2 → < 3 → skip.
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ depth: 20, params: { iron_total: 0.2 } }),
                buildRow({ depth: 30, params: { iron_total: 'broken' } }),
                buildRow({ depth: 40, params: { iron_total: 0.4 } }),
            ]);
            const res = await service.query(buildDto());

            const sandy = res.layers.find((l) => l.id === 'sandy');
            expect(sandy?.medianChemistry.iron_total).toBeUndefined();
        });

        it('NaN / Infinity в params — игнорируются', async () => {
            // 3 точки, две из них Infinity / NaN — собрана только 1 → skip.
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ depth: 20, params: { iron_total: 0.3 } }),
                buildRow({ depth: 30, params: { iron_total: Number.POSITIVE_INFINITY } }),
                buildRow({ depth: 40, params: { iron_total: Number.NaN } }),
            ]);
            const res = await service.query(buildDto());

            const sandy = res.layers.find((l) => l.id === 'sandy');
            expect(sandy?.medianChemistry.iron_total).toBeUndefined();
        });

        it('несколько paramCode в одном bucket — каждый агрегируется независимо', async () => {
            // 3 точки с 2 разными paramCode'ами — оба должны попасть в medianChemistry.
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ depth: 20, params: { iron_total: 0.2, hardness_total: 5 } }),
                buildRow({ depth: 30, params: { iron_total: 0.4, hardness_total: 7 } }),
                buildRow({ depth: 40, params: { iron_total: 0.6, hardness_total: 9 } }),
            ]);
            const res = await service.query(buildDto());

            const sandy = res.layers.find((l) => l.id === 'sandy');
            expect(sandy?.medianChemistry.iron_total).toBe(0.4);
            expect(sandy?.medianChemistry.hardness_total).toBe(7);
        });
    });

    // -----------------------------------------------------------------------
    // maxDepth — Infinity → null защита
    // -----------------------------------------------------------------------

    describe('maxDepth (Number.isFinite)', () => {
        it('artesian (5-й bucket) имеет max=Infinity → maxDepth=null в response', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.query(buildDto());

            const artesian = res.layers.find((l) => l.id === 'artesian');
            // Infinity → JSON.stringify даёт null, нам важно явно вернуть null
            // (не undefined, не Infinity, не "Infinity") чтобы фронт получил
            // консистентный {"maxDepth": null} вместо строки.
            expect(artesian?.maxDepth).toBeNull();
            expect(Number.isFinite(artesian?.maxDepth)).toBe(false);
        });

        it('первые 4 bucket имеют конечный max → maxDepth число', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.query(buildDto());

            const finiteLayers = res.layers.filter((l) => l.id !== 'artesian');
            expect(finiteLayers).toHaveLength(4);
            for (const l of finiteLayers) {
                expect(typeof l.maxDepth).toBe('number');
                expect(Number.isFinite(l.maxDepth)).toBe(true);
            }
            // Конкретные значения по AQUIFER_LAYERS.
            expect(res.layers.find((l) => l.id === 'top_water')?.maxDepth).toBe(15);
            expect(res.layers.find((l) => l.id === 'sandy')?.maxDepth).toBe(50);
            expect(res.layers.find((l) => l.id === 'sandy_limestone')?.maxDepth).toBe(100);
            expect(res.layers.find((l) => l.id === 'limestone')?.maxDepth).toBe(200);
        });

        it('JSON-сериализация artesian.maxDepth — null (не "Infinity"-строка)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.query(buildDto());
            const json = JSON.stringify(res);
            // Ищем "maxDepth":null в layers (artesian-bucket).
            expect(json).toMatch(/"id":"artesian"[^}]*"maxDepth":null/);
            // И НЕ ищем "Infinity"-строку (это критично — JSON.stringify на сырой
            // Infinity дал бы "maxDepth":null implicit, но тест защищает что мы
            // сами явно null поставили на этапе агрегации).
            expect(json).not.toMatch(/Infinity/);
        });
    });

    // -----------------------------------------------------------------------
    // computeDominantLayerId
    // -----------------------------------------------------------------------

    describe('computeDominantLayerId', () => {
        it('возвращает id с максимальным count', async () => {
            // sandy_limestone лидер с 5, остальные меньше.
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ depth: 5 }), // top_water (1)
                buildRow({ depth: 30 }), // sandy (1)
                buildRow({ depth: 60 }), // sandy_limestone (1)
                buildRow({ depth: 70 }), // sandy_limestone (2)
                buildRow({ depth: 80 }), // sandy_limestone (3)
                buildRow({ depth: 90 }), // sandy_limestone (4)
                buildRow({ depth: 95 }), // sandy_limestone (5)
                buildRow({ depth: 150 }), // limestone (1)
            ]);
            const res = await service.query(buildDto());
            expect(res.dominantLayerId).toBe('sandy_limestone');
        });

        it('возвращает null когда total=0 (пустой rows)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.query(buildDto());
            expect(res.dominantLayerId).toBeNull();
        });

        it('tie-breaker — `>` (не `>=`) → первый из AQUIFER_LAYERS остаётся best', async () => {
            // top_water=2 и sandy=2 ровно одинаковые → top_water выигрывает (первый в массиве).
            // reduce использует `cur.count > best.count` (не `>=`), значит при равенстве
            // остаётся текущий best (top_water).
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ depth: 5 }), // top_water (1)
                buildRow({ depth: 10 }), // top_water (2)
                buildRow({ depth: 20 }), // sandy (1)
                buildRow({ depth: 30 }), // sandy (2)
            ]);
            const res = await service.query(buildDto());
            expect(res.dominantLayerId).toBe('top_water');
        });

        it('tie-breaker между sandy и sandy_limestone → sandy выигрывает (раньше в AQUIFER_LAYERS)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ depth: 20 }), // sandy
                buildRow({ depth: 30 }), // sandy
                buildRow({ depth: 60 }), // sandy_limestone
                buildRow({ depth: 70 }), // sandy_limestone
            ]);
            const res = await service.query(buildDto());
            expect(res.dominantLayerId).toBe('sandy');
        });
    });

    // -----------------------------------------------------------------------
    // buildIntakeFilter — три варианта intakeType
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
    // buildCacheKey — стабильный ключ
    // -----------------------------------------------------------------------

    describe('cache key', () => {
        it('cache.get вызывается с детерминированным ключом формата `aquifer-stats:<intake>:W:S:E:N`', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            await service.query(
                buildDto({
                    intakeType: 'well',
                    west: 36.5,
                    south: 54.8,
                    east: 39.0,
                    north: 56.5,
                }),
            );
            expect(redis.get).toHaveBeenCalledWith(
                'aquifer-stats:well:36.5000:54.8000:39.0000:56.5000',
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
            const variants: TIntakeTypeFilter[] = ['all', 'well', 'well_dug'];
            for (const v of variants) {
                await service.query(buildDto({ intakeType: v }));
            }
            const keys = redis.get.mock.calls.map((call) => call[0] as string);
            expect(new Set(keys).size).toBe(3);
            expect(keys[0]).toMatch(/aquifer-stats:all:/);
            expect(keys[1]).toMatch(/aquifer-stats:well:/);
            expect(keys[2]).toMatch(/aquifer-stats:well_dug:/);
        });

        it('разные bbox → разные cache-keys', async () => {
            prisma.$queryRaw.mockResolvedValue([]);
            await service.query(buildDto({ west: 36.5 }));
            await service.query(buildDto({ west: 37.0 }));
            const keys = redis.get.mock.calls.map((call) => call[0] as string);
            expect(keys[0]).not.toBe(keys[1]);
        });

        it('cache-key округляет координаты до 4 знаков (toFixed(4))', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            await service.query(
                buildDto({
                    west: 36.123456789,
                    south: 54.987654321,
                    east: 39.111111111,
                    north: 56.222222222,
                }),
            );
            expect(redis.get).toHaveBeenCalledWith(
                'aquifer-stats:all:36.1235:54.9877:39.1111:56.2222',
            );
        });
    });

    // -----------------------------------------------------------------------
    // Cache hit / miss / errors
    // -----------------------------------------------------------------------

    describe('cache behaviour', () => {
        it('cache hit: redis.get → valid JSON → response.cached=true, нет SQL', async () => {
            const cached: AquiferStatsResponseDto = {
                layers: [],
                intakeType: 'all',
                totalWells: 0,
                samplesUsed: 0,
                dominantLayerId: null,
                timeTakenMs: 42,
                cached: false, // пишется false, при HIT — переписываем на true
            };
            redis.get.mockResolvedValueOnce(JSON.stringify(cached));

            const res = await service.query(buildDto());

            expect(res.cached).toBe(true);
            expect(res.layers).toEqual([]);
            expect(res.intakeType).toBe('all');
            expect(prisma.$queryRaw).not.toHaveBeenCalled();
        });

        it('cache miss: SQL вызывается + redis.set с TTL = AQUIFER_STATS_CACHE_TTL_SECONDS (86400)', async () => {
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
            expect(key).toMatch(/^aquifer-stats:well:/);
            expect(typeof value).toBe('string');
            expect(mode).toBe('EX');
            expect(ttl).toBe(AQUIFER_STATS_CACHE_TTL_SECONDS);
        });

        it('Redis GET error → fall through to SQL без падения', async () => {
            redis.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
            prisma.$queryRaw.mockResolvedValueOnce([buildRow()]);

            const res = await service.query(buildDto());

            expect(res.cached).toBe(false);
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
        });
    });

    // -----------------------------------------------------------------------
    // Response shape
    // -----------------------------------------------------------------------

    describe('response shape', () => {
        it('echo intakeType + totalWells + samplesUsed + dominantLayerId', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ depth: 20 }),
                buildRow({ depth: 30 }),
                buildRow({ depth: 70 }),
            ]);
            const res = await service.query(buildDto({ intakeType: 'well' }));

            expect(res.intakeType).toBe('well');
            expect(res.totalWells).toBe(3);
            // samplesUsed === totalWells (всё уместилось в SAMPLE_LIMIT=5000).
            expect(res.samplesUsed).toBe(3);
            expect(res.cached).toBe(false);
            expect(typeof res.timeTakenMs).toBe('number');
            expect(res.timeTakenMs).toBeGreaterThanOrEqual(0);
            // sandy лидер с 2 точками — dominant.
            expect(res.dominantLayerId).toBe('sandy');
        });

        it('totalWells === samplesUsed === rows.length (нет clipping в сервисе — LIMIT через SQL)', async () => {
            const rows = Array.from({ length: 100 }, () => buildRow({ depth: 30 }));
            prisma.$queryRaw.mockResolvedValueOnce(rows);
            const res = await service.query(buildDto());

            expect(res.totalWells).toBe(100);
            expect(res.samplesUsed).toBe(100);
        });
    });
});
