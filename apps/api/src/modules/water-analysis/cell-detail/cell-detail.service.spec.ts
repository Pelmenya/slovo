import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '@slovo/database';
import {
    CELL_DETAIL_REDIS_TOKEN,
    CELL_DETAIL_TOP_PROBLEMS_N,
} from '../water-analysis.constants';
import { CellDetailService } from './cell-detail.service';
import type { CellDetailRequestDto } from './dto/cell-detail.request.dto';

// =============================================================================
// CellDetailService unit-тесты — мокаем Prisma.$queryRaw + Redis.
//
// Покрываем:
//   - empty cell (нет rows) → пустой topProblems / inNormParams / nTotal=0
//   - happy: 3 проблемных + 1 в норме → topProblems sort by exceedsPct desc
//   - boundary: 5 проблемных, CELL_DETAIL_TOP_PROBLEMS_N=5 → ровно 5 в topProblems
//   - больше 5 → truncated до N + остальные не теряются (просто не попадают)
//   - param с NaN value → skipped из values, не считается измерением
//   - cache hit / miss / Redis error fall-through
// =============================================================================

type TPrismaMock = { $queryRaw: jest.Mock };
type TRedisMock = { get: jest.Mock; set: jest.Mock };
type TCellRow = { params: Record<string, unknown>; sample_date: Date };

describe('CellDetailService', () => {
    let service: CellDetailService;
    let prisma: TPrismaMock;
    let redis: TRedisMock;

    async function setup(): Promise<void> {
        prisma = { $queryRaw: jest.fn() };
        redis = {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue('OK'),
        };
        const moduleRef: TestingModule = await Test.createTestingModule({
            providers: [
                CellDetailService,
                { provide: PrismaService, useValue: prisma },
                { provide: CELL_DETAIL_REDIS_TOKEN, useValue: redis },
            ],
        }).compile();
        service = moduleRef.get(CellDetailService);
    }

    function buildDto(): CellDetailRequestDto {
        return { lat: 55.755, lon: 37.625, grid: 0.05 } as CellDetailRequestDto;
    }

    function buildRow(params: Record<string, number>, sampleDate = '2024-06-15'): TCellRow {
        return { params, sample_date: new Date(`${sampleDate}T00:00:00.000Z`) };
    }

    beforeEach(async () => {
        await setup();
    });

    describe('empty cell', () => {
        it('SQL вернул [] → topProblems=[], inNormParams=[], nTotal=0, dates=null', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.detail(buildDto());

            expect(res.topProblems).toEqual([]);
            expect(res.inNormParams).toEqual([]);
            expect(res.nTotal).toBe(0);
            expect(res.nWithExceedance).toBe(0);
            expect(res.earliestSampleDate).toBeNull();
            expect(res.latestSampleDate).toBeNull();
            expect(res.cellLat).toBe(55.755);
            expect(res.cellLon).toBe(37.625);
            expect(res.grid).toBe(0.05);
            expect(res.cached).toBe(false);
        });
    });

    describe('happy: проблемы + норма + sort', () => {
        it('iron 1.5 (ПДК 0.3) превышает, ph 7.2 (ПДК 6-9) в норме → topProblems[0]=iron, inNormParams=[ph]', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ iron_total: 1.5, ph: 7.2 }),
            ]);
            const res = await service.detail(buildDto());

            expect(res.topProblems).toHaveLength(1);
            expect(res.topProblems[0].paramCode).toBe('iron_total');
            expect(res.topProblems[0].exceedsCount).toBe(1);
            expect(res.topProblems[0].exceedsPct).toBe(100);
            expect(res.topProblems[0].max).toBe(1.5);
            expect(res.inNormParams).toContain('ph');
            expect(res.nTotal).toBe(1);
            expect(res.nWithExceedance).toBe(1);
        });

        it('exceedsPct desc → высокое превышение сверху', async () => {
            // 10 rows: iron exceeded в 8/10, manganese — в 4/10, hardness — в 2/10
            const rows: TCellRow[] = [];
            for (let i = 0; i < 10; i++) {
                rows.push(buildRow({
                    iron_total: i < 8 ? 1.5 : 0.1,
                    manganese: i < 4 ? 0.5 : 0.01,
                    hardness_total: i < 2 ? 10 : 3,
                }));
            }
            prisma.$queryRaw.mockResolvedValueOnce(rows);
            const res = await service.detail(buildDto());

            expect(res.topProblems[0].paramCode).toBe('iron_total');
            expect(res.topProblems[0].exceedsPct).toBe(80);
            expect(res.topProblems[1].paramCode).toBe('manganese');
            expect(res.topProblems[1].exceedsPct).toBe(40);
            expect(res.topProblems[2].paramCode).toBe('hardness_total');
            expect(res.topProblems[2].exceedsPct).toBe(20);
        });

        it('range pdk pH out-of-range → попадает в topProblems', async () => {
            // ph 5 (< 6) → exceedance, ph 7 → in norm
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ ph: 5 }),
                buildRow({ ph: 7 }),
            ]);
            const res = await service.detail(buildDto());

            const phEntry = res.topProblems.find((p) => p.paramCode === 'ph');
            expect(phEntry).toBeDefined();
            expect(phEntry!.exceedsCount).toBe(1);
            expect(phEntry!.exceedsPct).toBe(50);
        });
    });

    describe(`top-N truncation (N=${CELL_DETAIL_TOP_PROBLEMS_N})`, () => {
        it(`>${CELL_DETAIL_TOP_PROBLEMS_N} проблемных → topProblems.length=${CELL_DETAIL_TOP_PROBLEMS_N}`, async () => {
            // 7 разных paramов с превышениями (все 100% exceedsPct, разные exceedsCount)
            const params: Record<string, number> = {
                iron_total: 1.5, // ПДК 0.3
                manganese: 0.5, // ПДК 0.1
                nitrates: 60, // ПДК 45
                nitrites: 5, // ПДК 3
                ammonium: 5, // ПДК 1.5
                tds: 1500, // ПДК 1000
                fluorides: 2, // ПДК 1.5
            };
            prisma.$queryRaw.mockResolvedValueOnce([buildRow(params)]);
            const res = await service.detail(buildDto());

            expect(res.topProblems).toHaveLength(CELL_DETAIL_TOP_PROBLEMS_N);
        });
    });

    describe('rejection of invalid values', () => {
        it('non-number value (string в jsonb) → skipped, не считается measurement', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ iron_total: 'invalid' as unknown as number, ph: 7.2 }),
            ]);
            const res = await service.detail(buildDto());

            // iron_total не имеет measurements → не попадает ни в topProblems ни в inNorm
            expect(res.topProblems.find((p) => p.paramCode === 'iron_total')).toBeUndefined();
            expect(res.inNormParams).not.toContain('iron_total');
            // ph попадает в inNorm
            expect(res.inNormParams).toContain('ph');
        });

        it('NaN value → skipped (Number.isFinite check)', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ iron_total: NaN, ph: 7.2 }),
            ]);
            const res = await service.detail(buildDto());

            expect(res.topProblems.find((p) => p.paramCode === 'iron_total')).toBeUndefined();
        });
    });

    describe('cache', () => {
        it('cache HIT → возврат cached с обновлённым cached=true и timeTakenMs', async () => {
            redis.get.mockResolvedValueOnce(
                JSON.stringify({
                    topProblems: [],
                    inNormParams: ['ph'],
                    nTotal: 5,
                    nWithExceedance: 0,
                    earliestSampleDate: '2024-01-01',
                    latestSampleDate: '2024-12-01',
                    cellLat: 55.755,
                    cellLon: 37.625,
                    grid: 0.05,
                    timeTakenMs: 999,
                    cached: false,
                }),
            );
            const res = await service.detail(buildDto());

            expect(res.cached).toBe(true);
            expect(res.nTotal).toBe(5);
            expect(prisma.$queryRaw).not.toHaveBeenCalled();
            // timeTakenMs обновляется на cache-hit пути (не закешированное 999)
            expect(res.timeTakenMs).toBeLessThan(100);
        });

        it('Redis GET error → fall through в SQL (не валит request)', async () => {
            redis.get.mockRejectedValueOnce(new Error('Redis down'));
            prisma.$queryRaw.mockResolvedValueOnce([]);
            const res = await service.detail(buildDto());

            expect(res.cached).toBe(false);
            expect(res.nTotal).toBe(0);
        });
    });

    describe('date range', () => {
        it('earliest/latest = min/max sample_date в rows', async () => {
            prisma.$queryRaw.mockResolvedValueOnce([
                buildRow({ ph: 7 }, '2026-04-29'),
                buildRow({ ph: 7 }, '2020-03-15'),
                buildRow({ ph: 7 }, '2023-08-10'),
            ]);
            const res = await service.detail(buildDto());

            expect(res.earliestSampleDate).toBe('2020-03-15');
            expect(res.latestSampleDate).toBe('2026-04-29');
        });
    });
});
