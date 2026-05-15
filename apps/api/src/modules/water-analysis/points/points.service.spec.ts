import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '@slovo/database';
import {
    POINTS_CACHE_TTL_SECONDS,
    POINTS_DEFAULT_LIMIT,
    POINTS_REDIS_TOKEN,
} from '../water-analysis.constants';
import { PointsService } from './points.service';
import type { PointsQueryDto } from './dto/points.request.dto';
import type { PointsResponseDto } from './dto/points.response.dto';

// =============================================================================
// PointsService unit-тесты — мокаем Prisma.$queryRaw + Redis.
//
// Покрываем:
//   - validateBbox (5 веток)
//   - truncated flag — LIMIT+1 fetch, slice(limit)
//   - roundCoord — PII obfuscation до 0.005°
//   - sanitizeParams — number / string / NaN / Infinity / negative
//   - computeRisk — null когда все 4 undefined / частичные / clip 100 / round / drift guard
//   - mapRowToFeature — shape, sample_date.toISOString().slice(0, 10)
//   - default limit = POINTS_DEFAULT_LIMIT
//   - buildCacheKey — формат points:W:S:E:N:limit
//   - cache hit / miss / Redis error fall-through
//   - response shape
//
// Real PostgreSQL + Redis НЕ нужны (e2e под отдельный testcontainer setup).
// =============================================================================

type TPointRow = {
    intake_type: string;
    depth_meters: number | null;
    sample_date: Date;
    region: string | null;
    locality: string | null;
    params: Record<string, unknown>;
    lon: number;
    lat: number;
};

type TPrismaMock = {
    $queryRaw: jest.Mock;
};

type TRedisMock = {
    get: jest.Mock;
    set: jest.Mock;
};

describe('PointsService', () => {
    let service: PointsService;
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
                PointsService,
                { provide: PrismaService, useValue: prisma },
                { provide: POINTS_REDIS_TOKEN, useValue: redis },
            ],
        }).compile();
        service = moduleRef.get(PointsService);
    }

    function buildDto(overrides: Partial<PointsQueryDto> = {}): PointsQueryDto {
        return {
            west: overrides.west ?? 36.5,
            south: overrides.south ?? 54.8,
            east: overrides.east ?? 39.0,
            north: overrides.north ?? 56.5,
            limit: overrides.limit,
        } as PointsQueryDto;
    }

    function buildRow(overrides: Partial<TPointRow> = {}): TPointRow {
        return {
            intake_type: 'well',
            depth_meters: 45,
            sample_date: new Date('2024-06-15T09:00:00.000Z'),
            region: 'Московская область',
            locality: 'Раменское',
            params: { iron_total: 0.42, hardness_total: 7.8, ph: 7.2, manganese: 0.05 },
            lon: 37.6173,
            lat: 55.7558,
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
    // truncated flag — LIMIT+1 fetch
    // -----------------------------------------------------------------------

    describe('truncated flag', () => {
        it('rows.length > limit → truncated=true + slice(limit)', async () => {
            // limit=10 → fetch=11. Возвращаем 11 rows → truncated=true, features.length=10.
            // Используем locality как identifier чтобы проверить порядок (orderNumber
            // удалён из response из-за PII risk — security-auditor 2026-05-08).
            const rows = Array.from({ length: 11 }, (_, i) =>
                buildRow({ locality: `City-${String(i)}` }),
            );
            prisma.$queryRaw.mockResolvedValueOnce(rows);

            const res = await service.query(buildDto({ limit: 10 }));

            expect(res.truncated).toBe(true);
            expect(res.features).toHaveLength(10);
            expect(res.count).toBe(10);
            expect(res.limit).toBe(10);
            // Берём первые 10 — locality'и 0..9.
            expect(res.features.map((f) => f.properties.locality)).toEqual([
                'City-0',
                'City-1',
                'City-2',
                'City-3',
                'City-4',
                'City-5',
                'City-6',
                'City-7',
                'City-8',
                'City-9',
            ]);
        });

        it('rows.length === limit → truncated=false (граница: не сработал LIMIT+1)', async () => {
            // Если в БД ровно 10 точек и limit=10, fetch=11 вернул 10 → нечего truncate.
            const rows = Array.from({ length: 10 }, (_, i) =>
                buildRow({ locality: `City-${String(i)}` }),
            );
            prisma.$queryRaw.mockResolvedValueOnce(rows);

            const res = await service.query(buildDto({ limit: 10 }));

            expect(res.truncated).toBe(false);
            expect(res.features).toHaveLength(10);
            expect(res.count).toBe(10);
        });

        it('rows.length < limit → truncated=false', async () => {
            const rows = Array.from({ length: 3 }, (_, i) =>
                buildRow({ locality: `City-${String(i)}` }),
            );
            prisma.$queryRaw.mockResolvedValueOnce(rows);

            const res = await service.query(buildDto({ limit: 10 }));

            expect(res.truncated).toBe(false);
            expect(res.features).toHaveLength(3);
            expect(res.count).toBe(3);
        });

        it('пустой rows → truncated=false / features=[] / count=0', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.query(buildDto());

            expect(res.truncated).toBe(false);
            expect(res.features).toEqual([]);
            expect(res.count).toBe(0);
            expect(res.type).toBe('FeatureCollection');
        });
    });

    // -----------------------------------------------------------------------
    // roundCoord — PII obfuscation
    // -----------------------------------------------------------------------

    describe('roundCoord (PII obfuscation до 0.005°)', () => {
        it('lon=37.6173 → 37.615 (округление до 0.005°)', async () => {
            // grid=200 → 1°/200 = 0.005°.
            // 37.6173 * 200 = 7523.46 → Math.round(7523.46) = 7523 → 7523/200 = 37.615.
            prisma.$queryRaw.mockResolvedValueOnce([buildRow({ lon: 37.6173, lat: 55.7558 })]);

            const res = await service.query(buildDto());
            const [lon, lat] = res.features[0].geometry.coordinates;

            // 37.6173 * 200 = 7523.46 → round → 7523 → /200 = 37.615.
            expect(lon).toBe(37.615);
            // 55.7558 * 200 = 11151.16 → round → 11151 → /200 = 55.755.
            expect(lat).toBe(55.755);
        });

        it('значения близкие к границе грид-cell округляются к ближайшему мульти 0.005', async () => {
            // 37.6125 * 200 = 7522.4999...9 (float) → Math.round → 7522 → /200 = 37.61.
            // Это ОК — главное что результат — мульти 0.005 (k-anonymity grid).
            // Float-точность 37.6125 уже не точная половина, поэтому результат
            // зависит от внутреннего представления. Проверяем главное: точка
            // легит на сетке 0.005°.
            prisma.$queryRaw.mockResolvedValueOnce([buildRow({ lon: 37.6125, lat: 55.0 })]);
            const res = await service.query(buildDto());
            const lon = res.features[0].geometry.coordinates[0];
            // Значение должно быть мульти 0.005 (т.е. lon * 200 целое).
            expect(Number.isInteger(lon * 200)).toBe(true);
            // И конкретно — 37.61 либо 37.615 (близко к 37.6125).
            expect([37.61, 37.615]).toContain(lon);
        });

        it('точные мульти 0.005 значения остаются неизменными', async () => {
            // 37.610 * 200 = 7522 — целое, round не меняет.
            prisma.$queryRaw.mockResolvedValueOnce([buildRow({ lon: 37.61, lat: 55.755 })]);
            const res = await service.query(buildDto());
            expect(res.features[0].geometry.coordinates).toEqual([37.61, 55.755]);
        });

        it('отрицательные координаты — round симметрично работает', async () => {
            // -37.6173 * 200 = -7523.46 → Math.round(-7523.46) = -7523 → /200 = -37.615.
            prisma.$queryRaw.mockResolvedValueOnce([buildRow({ lon: -37.6173, lat: -55.7558 })]);
            const res = await service.query(buildDto());
            expect(res.features[0].geometry.coordinates).toEqual([-37.615, -55.755]);
        });
    });

    // -----------------------------------------------------------------------
    // sanitizeParams
    // -----------------------------------------------------------------------

    describe('sanitizeParams', () => {
        it('number → принимается', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { iron_total: 0.5 } }),
            ]);
            const res = await service.query(buildDto());
            expect(res.features[0].properties.params).toEqual({ iron_total: 0.5 });
        });

        it('string → отбрасывается ({iron: 0.5, str: "foo"} → {iron: 0.5})', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { iron_total: 0.5, label: 'foo' } }),
            ]);
            const res = await service.query(buildDto());
            expect(res.features[0].properties.params).toEqual({ iron_total: 0.5 });
            expect(res.features[0].properties.params.label).toBeUndefined();
        });

        it('NaN → отбрасывается ({iron: NaN} → {})', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { iron_total: Number.NaN } }),
            ]);
            const res = await service.query(buildDto());
            expect(res.features[0].properties.params).toEqual({});
        });

        it('Infinity → отбрасывается ({iron: Infinity} → {})', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { iron_total: Number.POSITIVE_INFINITY } }),
            ]);
            const res = await service.query(buildDto());
            expect(res.features[0].properties.params).toEqual({});
        });

        it('-Infinity → отбрасывается', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { iron_total: Number.NEGATIVE_INFINITY } }),
            ]);
            const res = await service.query(buildDto());
            expect(res.features[0].properties.params).toEqual({});
        });

        it('negative valid number → принимается (например temperature=-0.1)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { iron_total: -0.1 } }),
            ]);
            const res = await service.query(buildDto());
            expect(res.features[0].properties.params).toEqual({ iron_total: -0.1 });
        });

        it('null / undefined / boolean / object → отбрасываются', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({
                    params: {
                        iron_total: 0.5,
                        nullParam: null,
                        undefParam: undefined,
                        boolParam: true,
                        objParam: { nested: 1 },
                    },
                }),
            ]);
            const res = await service.query(buildDto());
            expect(res.features[0].properties.params).toEqual({ iron_total: 0.5 });
        });
    });

    // -----------------------------------------------------------------------
    // computeRisk
    // -----------------------------------------------------------------------

    describe('computeRisk', () => {
        it('все 4 ключевых поля undefined → null', async () => {
            // Нет ни hardness_total, ни iron_total, ни manganese, ни tds.
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { ph: 7.2, color: 5 } }),
            ]);
            const res = await service.query(buildDto());
            expect(res.features[0].properties.risk).toBeNull();
        });

        it('пустой params → risk=null', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([buildRow({ params: {} })]);
            const res = await service.query(buildDto());
            expect(res.features[0].properties.risk).toBeNull();
        });

        it('{hardness_total: 7} → 25 (1 × 25%)', async () => {
            // hardness_total=7 (точно ПДК) → доля 7/7=1.0 → 25%. Остальные 0.
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { hardness_total: 7 } }),
            ]);
            const res = await service.query(buildDto());
            expect(res.features[0].properties.risk).toBe(25);
        });

        it('{iron_total: 0.3} → 25 (1 × 25%)', async () => {
            // iron_total=0.3 (точно ПДК) → 25%.
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { iron_total: 0.3 } }),
            ]);
            const res = await service.query(buildDto());
            expect(res.features[0].properties.risk).toBe(25);
        });

        it('{manganese: 0.1} → 25', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { manganese: 0.1 } }),
            ]);
            const res = await service.query(buildDto());
            expect(res.features[0].properties.risk).toBe(25);
        });

        it('{tds: 1000} → 25', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { tds: 1000 } }),
            ]);
            const res = await service.query(buildDto());
            expect(res.features[0].properties.risk).toBe(25);
        });

        it('все 4 параметра на ПДК → 100', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({
                    params: { hardness_total: 7, iron_total: 0.3, manganese: 0.1, tds: 1000 },
                }),
            ]);
            const res = await service.query(buildDto());
            expect(res.features[0].properties.risk).toBe(100);
        });

        it('clip до 100 при extreme values (hardness=14 → 50%, iron=0.6 → 50%, mn=0.2 → 50%, tds=2000 → 50% = 200 → clip 100)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({
                    params: { hardness_total: 14, iron_total: 0.6, manganese: 0.2, tds: 2000 },
                }),
            ]);
            const res = await service.query(buildDto());
            expect(res.features[0].properties.risk).toBe(100);
        });

        it('clip 100 на еще более extreme values (×100)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({
                    params: { hardness_total: 700, iron_total: 30, manganese: 10, tds: 100000 },
                }),
            ]);
            const res = await service.query(buildDto());
            expect(res.features[0].properties.risk).toBe(100);
        });

        it('round до целого (hardness=3.5 → 0.5×25=12.5 → 13)', async () => {
            // 3.5/7 = 0.5 → 12.5% → round → 13.
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { hardness_total: 3.5 } }),
            ]);
            const res = await service.query(buildDto());
            expect(res.features[0].properties.risk).toBe(13);
        });

        it('частичные данные (hardness=5, iron=0.15) — partial sum', async () => {
            // hardness=5 → 5/7 ≈ 0.714 → 17.857%, iron=0.15 → 0.5 → 12.5%.
            // Сумма ≈ 30.357 → round → 30. mn / tds = undefined → ?? 0 = 0.
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { hardness_total: 5, iron_total: 0.15 } }),
            ]);
            const res = await service.query(buildDto());
            expect(res.features[0].properties.risk).toBe(30);
        });

        it('drift guard — формула совпадает с heatmap.service.ts (LEAST(100, sum 25%-долей))', async () => {
            // Это инвариант: TS computeRisk и SQL heatmap дают одинаковый score
            // при одинаковом input. Если кто-то поменяет одну сторону без другой
            // — три источника правды (БД-derived / heatmap SQL / points TS) разойдутся.
            //
            // Reference: heatmap.service.ts строки 187-190:
            //   COALESCE(((params->>'hardness_total')::numeric / 7.0) * 25, 0) +
            //   COALESCE(((params->>'iron_total')::numeric / 0.3) * 25, 0) +
            //   COALESCE(((params->>'manganese')::numeric / 0.1) * 25, 0) +
            //   COALESCE(((params->>'tds')::numeric / 1000.0) * 25, 0)
            // → LEAST(100, sum)
            //
            // Здесь явно проверяем тот же expected результат.
            const params = { hardness_total: 4, iron_total: 0.2, manganese: 0.05, tds: 500 };
            // hardness=4/7 × 25 = 14.2857
            // iron=0.2/0.3 × 25 = 16.6667
            // mn=0.05/0.1 × 25 = 12.5
            // tds=500/1000 × 25 = 12.5
            // total ≈ 55.952 → round → 56.
            prisma.$queryRaw.mockResolvedValueOnce([buildRow({ params })]);
            const res = await service.query(buildDto());
            expect(res.features[0].properties.risk).toBe(56);

            // Дополнительно — формула, повторяющая SQL точь-в-точь.
            const expected = Math.round(
                Math.min(
                    100,
                    (params.hardness_total / 7) * 25 +
                        (params.iron_total / 0.3) * 25 +
                        (params.manganese / 0.1) * 25 +
                        (params.tds / 1000) * 25,
                ),
            );
            expect(res.features[0].properties.risk).toBe(expected);
        });
    });

    // -----------------------------------------------------------------------
    // computePdkExceedanceRatio
    // -----------------------------------------------------------------------

    describe('computePdkExceedanceRatio', () => {
        it('Mn 0.83 (ПДК 0.1) → 8.3 — canonical UI example', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { manganese: 0.83 } }),
            ]);
            const res = await service.query(buildDto());
            expect(res.features[0].properties.pdkExceedanceRatio).toEqual({ manganese: 8.3 });
        });

        it('Fe 3.12 (ПДК 0.3) → 10.4 — canonical UI example', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { iron_total: 3.12 } }),
            ]);
            const res = await service.query(buildDto());
            expect(res.features[0].properties.pdkExceedanceRatio).toEqual({ iron_total: 10.4 });
        });

        it('multi-param exceedance (Mn + Fe + hardness) — все ratios в одном объекте', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({
                    params: { manganese: 0.83, iron_total: 3.12, hardness_total: 14.1 },
                }),
            ]);
            const res = await service.query(buildDto());
            // hardness 14.1 / 7 = 2.014... → 2.0 после round(×10)/10
            expect(res.features[0].properties.pdkExceedanceRatio).toEqual({
                manganese: 8.3,
                iron_total: 10.4,
                hardness_total: 2,
            });
        });

        it('safe params (Fe 0.1 < 0.3) — НЕ попадают в pdkExceedanceRatio', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { iron_total: 0.1, hardness_total: 5 } }),
            ]);
            const res = await service.query(buildDto());
            expect(res.features[0].properties.pdkExceedanceRatio).toEqual({});
        });

        it('range-type pdk (pH 9.5 — вне диапазона) — отсутствует (multiplier не имеет смысла)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { ph: 9.5, iron_total: 0.5 } }),
            ]);
            const res = await service.query(buildDto());
            // pH отсутствует, iron_total 0.5/0.3 = 1.6667 → 1.7
            expect(res.features[0].properties.pdkExceedanceRatio).toEqual({ iron_total: 1.7 });
        });

        it('non-regulated (temperature, electrical_conductivity) — отсутствуют', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { temperature: 25, electrical_conductivity: 800 } }),
            ]);
            const res = await service.query(buildDto());
            expect(res.features[0].properties.pdkExceedanceRatio).toEqual({});
        });

        it('пустой params → пустой pdkExceedanceRatio', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([buildRow({ params: {} })]);
            const res = await service.query(buildDto());
            expect(res.features[0].properties.pdkExceedanceRatio).toEqual({});
        });

        it('round до 1 знака (turbidity 6.3 / 2.6 = 2.4230... → 2.4)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ params: { turbidity: 6.3 } }),
            ]);
            const res = await service.query(buildDto());
            expect(res.features[0].properties.pdkExceedanceRatio).toEqual({ turbidity: 2.4 });
        });
    });

    // -----------------------------------------------------------------------
    // mapRowToFeature — shape
    // -----------------------------------------------------------------------

    describe('mapRowToFeature', () => {
        it('Feature shape — type / geometry / properties', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([buildRow()]);
            const res = await service.query(buildDto());

            const f = res.features[0];
            expect(f.type).toBe('Feature');
            expect(f.geometry.type).toBe('Point');
            expect(f.geometry.coordinates).toHaveLength(2);
            expect(f.properties.intakeType).toBe('well');
            expect(f.properties.depthMeters).toBe(45);
            expect(f.properties.region).toBe('Московская область');
            expect(f.properties.locality).toBe('Раменское');
            expect(typeof f.properties.params).toBe('object');
            expect(typeof f.properties.pdkExceedanceRatio).toBe('object');
            // Проверяем что orderNumber НЕ выходит наружу — это PII join-key
            // к Bitrix24/CRM-aqua, удалён в security-fix 2026-05-08.
            expect((f.properties as unknown as Record<string, unknown>).orderNumber).toBeUndefined();
        });

        it("sample_date.toISOString().slice(0, 10) → 'YYYY-MM-DD'", async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ sample_date: new Date('2024-06-15T09:00:00.000Z') }),
            ]);
            const res = await service.query(buildDto());
            expect(res.features[0].properties.sampleDate).toBe('2024-06-15');
        });

        it('sample_date в полночь UTC — корректный ISO date (без timezone shift)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ sample_date: new Date('2024-01-01T00:00:00.000Z') }),
            ]);
            const res = await service.query(buildDto());
            expect(res.features[0].properties.sampleDate).toBe('2024-01-01');
        });

        it('depthMeters=null корректно пробрасывается (для municipal/spring источников)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ depth_meters: null, intake_type: 'municipal' }),
            ]);
            const res = await service.query(buildDto());
            expect(res.features[0].properties.depthMeters).toBeNull();
            expect(res.features[0].properties.intakeType).toBe('municipal');
        });

        it('region / locality могут быть null (geocoding не успел / не нашёл)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ region: null, locality: null }),
            ]);
            const res = await service.query(buildDto());
            expect(res.features[0].properties.region).toBeNull();
            expect(res.features[0].properties.locality).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // Default limit
    // -----------------------------------------------------------------------

    describe('default limit', () => {
        it('limit undefined → POINTS_DEFAULT_LIMIT (200) echo в response', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.query(buildDto({ limit: undefined }));
            expect(res.limit).toBe(POINTS_DEFAULT_LIMIT);
            expect(res.limit).toBe(200);
        });

        it('limit explicit (50) echo в response', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.query(buildDto({ limit: 50 }));
            expect(res.limit).toBe(50);
        });

        it('limit explicit (500 max) echo в response', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.query(buildDto({ limit: 500 }));
            expect(res.limit).toBe(500);
        });
    });

    // -----------------------------------------------------------------------
    // buildCacheKey — стабильный ключ
    // -----------------------------------------------------------------------

    describe('cache key', () => {
        it('cache.get вызывается с детерминированным ключом формата `points:W:S:E:N:limit`', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            await service.query(
                buildDto({
                    west: 36.5,
                    south: 54.8,
                    east: 39.0,
                    north: 56.5,
                    limit: 100,
                }),
            );
            expect(redis.get).toHaveBeenCalledWith(
                'points:v5:36.5000:54.8000:39.0000:56.5000:100',
            );
        });

        it('одинаковые params → одинаковый cache-key (идемпотентность)', async () => {
            prisma.$queryRaw.mockResolvedValue([]);
            await service.query(buildDto());
            await service.query(buildDto());
            const keys = redis.get.mock.calls.map((call) => call[0] as string);
            expect(keys[0]).toBe(keys[1]);
        });

        it('разные limit при том же bbox → разные cache-keys', async () => {
            prisma.$queryRaw.mockResolvedValue([]);
            await service.query(buildDto({ limit: 100 }));
            await service.query(buildDto({ limit: 200 }));
            const keys = redis.get.mock.calls.map((call) => call[0] as string);
            expect(keys[0]).not.toBe(keys[1]);
            expect(keys[0]).toMatch(/:100$/);
            expect(keys[1]).toMatch(/:200$/);
        });

        it('default limit учитывается в cache-key', async () => {
            prisma.$queryRaw.mockResolvedValue([]);
            await service.query(buildDto({ limit: undefined }));
            await service.query(buildDto({ limit: POINTS_DEFAULT_LIMIT }));
            const keys = redis.get.mock.calls.map((call) => call[0] as string);
            // undefined + explicit 200 должны давать одинаковый ключ (default подменяется).
            expect(keys[0]).toBe(keys[1]);
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
                    limit: 100,
                }),
            );
            expect(redis.get).toHaveBeenCalledWith(
                'points:v5:36.1235:54.9877:39.1111:56.2222:100',
            );
        });
    });

    // -----------------------------------------------------------------------
    // Cache hit / miss / errors
    // -----------------------------------------------------------------------

    describe('cache behaviour', () => {
        it('cache hit: redis.get → valid JSON → response.cached=true, нет SQL', async () => {
            const cached: PointsResponseDto = {
                type: 'FeatureCollection',
                features: [],
                count: 0,
                truncated: false,
                limit: 200,
                timeTakenMs: 42,
                cached: false,
            };
            redis.get.mockResolvedValueOnce(JSON.stringify(cached));

            const res = await service.query(buildDto());

            expect(res.cached).toBe(true);
            expect(res.features).toEqual([]);
            expect(prisma.$queryRaw).not.toHaveBeenCalled();
        });

        it('cache miss: SQL вызывается + redis.set с TTL = POINTS_CACHE_TTL_SECONDS (3600)', async () => {
            redis.get.mockResolvedValueOnce(null);
            prisma.$queryRaw.mockResolvedValueOnce([buildRow()]);

            await service.query(buildDto({ limit: 200 }));
            await new Promise((r) => setImmediate(r));

            expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
            expect(redis.set).toHaveBeenCalledTimes(1);
            const [key, value, mode, ttl] = redis.set.mock.calls[0] as [
                string,
                string,
                string,
                number,
            ];
            expect(key).toMatch(/^points:/);
            expect(typeof value).toBe('string');
            expect(mode).toBe('EX');
            expect(ttl).toBe(POINTS_CACHE_TTL_SECONDS);
            expect(ttl).toBe(3600);
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

            const res = await service.query(buildDto());
            await new Promise((r) => setImmediate(r));

            expect(res.cached).toBe(false);
            expect(res.features).toHaveLength(1);
        });
    });

    // -----------------------------------------------------------------------
    // Response shape
    // -----------------------------------------------------------------------

    describe('response shape', () => {
        it('echo limit + truncated + count + type=FeatureCollection при cache miss', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([buildRow()]);
            const res = await service.query(buildDto({ limit: 50 }));

            expect(res.type).toBe('FeatureCollection');
            expect(res.limit).toBe(50);
            expect(res.truncated).toBe(false);
            expect(res.count).toBe(1);
            expect(res.cached).toBe(false);
            expect(typeof res.timeTakenMs).toBe('number');
            expect(res.timeTakenMs).toBeGreaterThanOrEqual(0);
        });

        it('count === features.length всегда (даже при truncated)', async () => {
            const rows = Array.from({ length: 11 }, (_, i) =>
                buildRow({ locality: `City-${String(i)}` }),
            );
            prisma.$queryRaw.mockResolvedValueOnce(rows);
            const res = await service.query(buildDto({ limit: 10 }));

            expect(res.count).toBe(res.features.length);
            expect(res.count).toBe(10);
            expect(res.truncated).toBe(true);
        });
    });
});
