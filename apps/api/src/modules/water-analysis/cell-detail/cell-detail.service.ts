import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@slovo/database';
import { WATER_PARAMS_BY_CODE } from '@slovo/water-blank-extraction';
import type Redis from 'ioredis';
import {
    CELL_DETAIL_CACHE_TTL_SECONDS,
    CELL_DETAIL_MAX_ROWS,
    CELL_DETAIL_REDIS_TOKEN,
    CELL_DETAIL_TOP_PROBLEMS_N,
} from '../water-analysis.constants';
import { percentile, roundTo, stringifyError } from '../_shared';
import type { CellDetailRequestDto } from './dto/cell-detail.request.dto';
import type {
    CellDetailResponseDto,
    ParamBreakdownDto,
} from './dto/cell-detail.response.dto';

// =============================================================================
// CellDetailService — детали отдельной cell на тепловой карте.
//
// Pipeline:
//   1. Cache lookup (по lat/lon/grid).
//   2. SQL: fetch до CELL_DETAIL_MAX_ROWS rows в bbox cell (центр ± grid/2)
//      через PostGIS && + GIST индекс. Sort by sample_date DESC чтобы свежие
//      попали при truncate.
//   3. TS aggregation per regulated paramу из СанПиН справочника:
//      - exceedsCount/exceedsPct/max/median per param
//      - sort by exceedsPct desc → topProblems[]
//      - paramы без exceedances → inNormParams[]
//   4. nWithExceedance — сколько rows had at least one param > ПДК.
//   5. Cache set TTL 1 час (data стабильное derived).
//
// Используется фронтом для popup на карте: тап cell → fetch this → BottomSheet
// modal с breakdown «топ проблем + что в норме». Без этого frontend имеет
// только exceedsPct/status (overview), не зная какой именно param проблемный.
// =============================================================================

@Injectable()
export class CellDetailService {
    private readonly logger = new Logger(CellDetailService.name);

    constructor(
        private readonly prisma: PrismaService,
        @Inject(CELL_DETAIL_REDIS_TOKEN) private readonly redis: Redis,
    ) {}

    async detail(dto: CellDetailRequestDto): Promise<CellDetailResponseDto> {
        const cacheKey = buildCacheKey(dto.lat, dto.lon, dto.grid);

        // t0 ловим до cache GET — на cache-hit получим honest «сколько user
        // ждал» (включая Redis GET), не закешированное старое SQL-время.
        const t0 = Date.now();

        const cached = await this.tryCacheGet(cacheKey);
        if (cached) {
            return { ...cached, cached: true, timeTakenMs: Date.now() - t0 };
        }

        const rows = await this.fetchRows(dto);
        const aggregated = aggregateRows(rows);
        const timeTakenMs = Date.now() - t0;

        const response: CellDetailResponseDto = {
            ...aggregated,
            cellLat: dto.lat,
            cellLon: dto.lon,
            grid: dto.grid,
            timeTakenMs,
            cached: false,
        };

        // fire-and-forget: tryCacheSet логирует cache-set ошибки внутри.
        void this.tryCacheSet(cacheKey, response);

        return response;
    }

    private async fetchRows(dto: CellDetailRequestDto): Promise<TCellRow[]> {
        // Cell bbox = центр ± grid/2. ST_MakeEnvelope в WGS84 — стандарт PostGIS.
        // GIST индекс на geo_point делает bbox-фильтр O(log n).
        const half = dto.grid / 2;
        const west = dto.lon - half;
        const east = dto.lon + half;
        const south = dto.lat - half;
        const north = dto.lat + half;

        return this.prisma.$queryRaw<TCellRow[]>`
            SELECT
                params,
                sample_date
            FROM water_analysis
            WHERE
                geo_point IS NOT NULL
                AND geo_point && ST_MakeEnvelope(
                    ${west}::float8, ${south}::float8,
                    ${east}::float8, ${north}::float8, 4326
                )::geography
            ORDER BY sample_date DESC
            LIMIT ${CELL_DETAIL_MAX_ROWS}
        `;
    }

    private async tryCacheGet(key: string): Promise<CellDetailResponseDto | null> {
        try {
            const raw = await this.redis.get(key);
            if (!raw) return null;
            return JSON.parse(raw) as CellDetailResponseDto;
        } catch (err) {
            this.logger.warn(`cell-detail cache GET failed: ${stringifyError(err)} (key=${key})`);
            return null;
        }
    }

    private async tryCacheSet(key: string, value: CellDetailResponseDto): Promise<void> {
        try {
            await this.redis.set(key, JSON.stringify(value), 'EX', CELL_DETAIL_CACHE_TTL_SECONDS);
        } catch (err) {
            this.logger.warn(`cell-detail cache SET failed: ${stringifyError(err)} (key=${key})`);
        }
    }
}

// =============================================================================
// Types + helpers
// =============================================================================

type TCellRow = {
    params: Record<string, unknown>;
    sample_date: Date;
};

type TAggregatedCell = {
    topProblems: ParamBreakdownDto[];
    inNormParams: string[];
    nTotal: number;
    nWithExceedance: number;
    earliestSampleDate?: string | null;
    latestSampleDate?: string | null;
};

/**
 * TS-side aggregation per regulated param + по rows. Source of truth для list
 * params + ПДК — `WATER_PARAMS_BY_CODE` (СанПиН 1.2.3685-21). Iterate через
 * params jsonb которые реально присутствуют в rows — params без measurements
 * в cell не попадают в результат (нет «pretend null» данных).
 */
function aggregateRows(rows: readonly TCellRow[]): TAggregatedCell {
    if (rows.length === 0) {
        return {
            topProblems: [],
            inNormParams: [],
            nTotal: 0,
            nWithExceedance: 0,
            earliestSampleDate: null,
            latestSampleDate: null,
        };
    }

    const breakdowns: ParamBreakdownDto[] = [];
    const rowExceedanceFlags = new Array<boolean>(rows.length).fill(false);

    for (const meta of Object.values(WATER_PARAMS_BY_CODE)) {
        if (!meta.regulated || meta.pdk === null) continue;
        // Narrow для closure: meta.pdk здесь точно non-null. TS не tracks
        // narrowing across forEach, копируем в локальную const.
        const pdk = meta.pdk;

        const values: number[] = [];
        const exceedanceRowIndexes: number[] = [];

        rows.forEach((row, idx) => {
            const raw = row.params[meta.paramCode];
            if (typeof raw !== 'number' || !Number.isFinite(raw)) return;
            values.push(raw);
            if (paramExceedsPdk(raw, pdk)) {
                exceedanceRowIndexes.push(idx);
            }
        });

        if (values.length === 0) continue;

        // Помечаем rows у которых хотя бы один param exceeded — для nWithExceedance.
        for (const i of exceedanceRowIndexes) {
            rowExceedanceFlags[i] = true;
        }

        const exceedsCount = exceedanceRowIndexes.length;
        const exceedsPct = Math.round((exceedsCount / values.length) * 100);
        const sorted = [...values].sort((a, b) => a - b);

        breakdowns.push({
            paramCode: meta.paramCode,
            nameRu: meta.nameRu,
            unit: meta.unit,
            pdk,
            n: values.length,
            exceedsCount,
            exceedsPct,
            max: roundTo(sorted[sorted.length - 1], 4),
            median: roundTo(percentile(sorted, 0.5), 4),
        });
    }

    // Sort: проблемные (exceedsPct > 0) сверху по exceedsPct desc, при равенстве
    // — по exceedsCount desc (больше абсолютных нарушений важнее). Безпроблемные —
    // alphabetical чтобы UI стабильно показывал список.
    const problematic = breakdowns
        .filter((b) => b.exceedsPct > 0)
        .sort((a, b) => b.exceedsPct - a.exceedsPct || b.exceedsCount - a.exceedsCount);
    const inNorm = breakdowns
        .filter((b) => b.exceedsPct === 0)
        .sort((a, b) => a.paramCode.localeCompare(b.paramCode));

    const topProblems = problematic.slice(0, CELL_DETAIL_TOP_PROBLEMS_N);
    const inNormParams = inNorm.map((b) => b.paramCode);

    const nWithExceedance = rowExceedanceFlags.filter(Boolean).length;

    // Date range — sort by sample_date уже сделан в SQL (DESC), но для
    // earliest/latest делаем explicit чтобы не полагаться на SQL ordering.
    const dates = rows.map((r) => r.sample_date.toISOString().slice(0, 10)).sort();
    const earliestSampleDate = dates[0];
    const latestSampleDate = dates[dates.length - 1];

    return {
        topProblems,
        inNormParams,
        nTotal: rows.length,
        nWithExceedance,
        earliestSampleDate,
        latestSampleDate,
    };
}

/**
 * Превышает ли значение ПДК. Single — `> pdk`. Range — `< min OR > max`
 * (out-of-range считается превышением, например pH < 6 или > 9).
 */
function paramExceedsPdk(value: number, pdk: number | { min: number; max: number }): boolean {
    if (typeof pdk === 'number') {
        return value > pdk;
    }
    return value < pdk.min || value > pdk.max;
}

function buildCacheKey(lat: number, lon: number, grid: number): string {
    // Округляем до 4 знаков (~11м) — соседние тапы по той же cell попадают в
    // один key, но при смене grid (zoom) — новый key.
    const r = (n: number): string => n.toFixed(4);
    return `cell-detail:${r(lat)}:${r(lon)}:${r(grid)}`;
}
