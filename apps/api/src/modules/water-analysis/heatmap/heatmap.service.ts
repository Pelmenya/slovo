import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@slovo/database';
import { WATER_PARAMS_BY_CODE } from '@slovo/water-blank-extraction';
import { Prisma } from '@prisma/client';
import type Redis from 'ioredis';
import {
    GRID_DEFAULT_DEG,
    HEATMAP_CACHE_TTL_SECONDS,
    HEATMAP_REDIS_TOKEN,
    type THeatmapParam,
} from '../water-analysis.constants';
import type { HeatmapQueryDto } from './dto/heatmap.request.dto';
import type {
    HeatmapFeatureDto,
    HeatmapResponseDto,
    THeatmapStatus,
} from './dto/heatmap.response.dto';

// =============================================================================
// HeatmapService — агрегированная тепловая карта качества воды.
//
// Архитектура:
//   1. Validate query (cross-field — bbox sanity), resolve PDK (canonical из
//      СанПиН справочника либо synthetic 50 для risk).
//   2. Cache lookup в Redis по ключу `heatmap:{paramName}:{west}:{south}:{east}:{north}:{grid}`.
//      Cache HIT → возврат, помечая `cached=true`. Cache MISS → SQL.
//   3. Prisma raw SQL: bbox-фильтр через PostGIS `&&` (GIST index на geo_point) +
//      grid-snap через FLOOR(coord/grid)*grid + grid/2 (центр ячейки) +
//      агрегации COUNT/AVG/PERCENTILE_CONT(0.5,0.75)/exceedsCount.
//   4. Risk случай — другой SELECT, формула weighted % от ПДК (та же что в
//      derived 05-normalize.ts).
//   5. Map rows → GeoJSON Features. Persist в Redis с TTL 24ч.
//
// Безопасность SQL: param name приходит из whitelist (HEATMAP_PARAMS) +
// class-validator @IsIn — то есть в SQL idёт известная константа, не
// произвольный input. Все числовые параметры — через $N parameterization
// (Prisma.sql template tag).
// =============================================================================

@Injectable()
export class HeatmapService {
    private readonly logger = new Logger(HeatmapService.name);

    constructor(
        private readonly prisma: PrismaService,
        @Inject(HEATMAP_REDIS_TOKEN) private readonly redis: Redis,
    ) {}

    async query(dto: HeatmapQueryDto): Promise<HeatmapResponseDto> {
        validateBbox(dto);

        const grid = dto.grid ?? GRID_DEFAULT_DEG;
        const param = dto.param;
        const resolvedPdk = resolvePdk(param);
        const cacheKey = buildCacheKey(param, dto.west, dto.south, dto.east, dto.north, grid);

        const cached = await this.tryCacheGet(cacheKey);
        if (cached) {
            return { ...cached, cached: true };
        }

        const t0 = Date.now();
        const rows = await this.runQuery(param, dto, grid, resolvedPdk);
        const timeTakenMs = Date.now() - t0;

        const features = mapRowsToFeatures(rows, param, resolvedPdk);
        const response: HeatmapResponseDto = {
            type: 'FeatureCollection',
            features,
            param,
            pdk: resolvedPdk.displayValue,
            grid,
            timeTakenMs,
            cached: false,
        };

        // Cache asynchronously — если Redis сейчас лежит, не блокируем response.
        // Errors молча проглатываются (см. tryCacheSet) — observability через
        // отдельный health-check Redis (memory `project_tech_debt` Redis-pool tuning).
        this.tryCacheSet(cacheKey, response).catch(() => {
            /* swallowed in tryCacheSet */
        });

        return response;
    }

    // -------- internal: SQL --------

    private async runQuery(
        param: THeatmapParam,
        dto: HeatmapQueryDto,
        grid: number,
        resolvedPdk: TResolvedPdk,
    ): Promise<TRawRow[]> {
        if (param === 'risk') {
            // resolvedPdk.kind === 'single' гарантировано (см. resolvePdk).
            const pdk = resolvedPdk.kind === 'single' ? resolvedPdk.pdk : RISK_PDK;
            return this.runRiskQuery(dto, grid, pdk);
        }
        return this.runParamQuery(param, dto, grid, resolvedPdk);
    }

    private async runParamQuery(
        param: Exclude<THeatmapParam, 'risk'>,
        dto: HeatmapQueryDto,
        grid: number,
        resolvedPdk: TResolvedPdk,
    ): Promise<TRawRow[]> {
        // exceedsCount CASE expression — ветвится по типу ПДК:
        //   single: val > pdk
        //   range:  val < min OR val > max  (только pH)
        //   none:   0  (нет норматива → exceedsCount всегда 0; параметр всё равно
        //              отображаем чтобы видеть distribution, например temperature)
        // Builder возвращает Prisma.Sql фрагмент — он inlined в финальный SQL
        // через template tag (Prisma это поддерживает безопасно через nested params).
        const exceedsExpr = buildExceedsExpr(resolvedPdk);

        // params->>'iron_total' returns NULL when key missing — фильтруем через `?`
        // (jsonb existence operator) для performance.
        // ::float8 cast обязателен на каждом числовом параметре — Prisma pg-driver
        // передаёт JS number как integer без явного cast'а.
        return this.prisma.$queryRaw<TRawRow[]>`
            WITH bounded AS (
                SELECT
                    geo_point::geometry AS geom,
                    params
                FROM water_analysis
                WHERE
                    geo_point IS NOT NULL
                    AND geo_point && ST_MakeEnvelope(
                        ${dto.west}::float8, ${dto.south}::float8,
                        ${dto.east}::float8, ${dto.north}::float8, 4326
                    )::geography
                    AND params ? ${param}
            ),
            extracted AS (
                SELECT
                    FLOOR(ST_X(geom) / ${grid}::float8) * ${grid}::float8 + ${grid}::float8 / 2 AS cell_lon,
                    FLOOR(ST_Y(geom) / ${grid}::float8) * ${grid}::float8 + ${grid}::float8 / 2 AS cell_lat,
                    ((params->>${param})::numeric)::float8 AS val
                FROM bounded
            )
            SELECT
                cell_lon::float8 AS cell_lon,
                cell_lat::float8 AS cell_lat,
                COUNT(*)::int AS count,
                AVG(val)::float8 AS mean,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY val)::float8 AS median,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY val)::float8 AS p75,
                ${exceedsExpr}::int AS exceeds_count
            FROM extracted
            GROUP BY cell_lon, cell_lat
            HAVING COUNT(*) >= 1
        `;
    }

    private async runRiskQuery(
        dto: HeatmapQueryDto,
        grid: number,
        riskThreshold: number,
    ): Promise<TRawRow[]> {
        // Risk = LEAST(100, sum 25%-долей превышения по 4 ключевым параметрам).
        // Та же формула что в derived (05-normalize.ts) и в mock-heatmap фронта —
        // три источника правды (БД / API / mock) согласованы.
        //
        // COALESCE → 0 если параметр отсутствует в записи. Это занижает risk
        // у records с неполным набором (что справедливо — risk без iron_total
        // должен быть < risk с измеренным iron_total).
        return this.prisma.$queryRaw<TRawRow[]>`
            WITH bounded AS (
                SELECT
                    geo_point::geometry AS geom,
                    params
                FROM water_analysis
                WHERE
                    geo_point IS NOT NULL
                    AND geo_point && ST_MakeEnvelope(
                        ${dto.west}::float8, ${dto.south}::float8,
                        ${dto.east}::float8, ${dto.north}::float8, 4326
                    )::geography
            ),
            extracted AS (
                SELECT
                    FLOOR(ST_X(geom) / ${grid}::float8) * ${grid}::float8 + ${grid}::float8 / 2 AS cell_lon,
                    FLOOR(ST_Y(geom) / ${grid}::float8) * ${grid}::float8 + ${grid}::float8 / 2 AS cell_lat,
                    LEAST(100,
                        COALESCE(((params->>'hardness_total')::numeric / 7.0) * 25, 0) +
                        COALESCE(((params->>'iron_total')::numeric / 0.3) * 25, 0) +
                        COALESCE(((params->>'manganese')::numeric / 0.1) * 25, 0) +
                        COALESCE(((params->>'tds')::numeric / 1000.0) * 25, 0)
                    )::float8 AS val
                FROM bounded
                WHERE
                    params ? 'hardness_total'
                    OR params ? 'iron_total'
                    OR params ? 'manganese'
                    OR params ? 'tds'
            )
            SELECT
                cell_lon::float8 AS cell_lon,
                cell_lat::float8 AS cell_lat,
                COUNT(*)::int AS count,
                AVG(val)::float8 AS mean,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY val)::float8 AS median,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY val)::float8 AS p75,
                SUM(CASE WHEN val > ${riskThreshold}::float8 THEN 1 ELSE 0 END)::int AS exceeds_count
            FROM extracted
            GROUP BY cell_lon, cell_lat
            HAVING COUNT(*) >= 1
        `;
    }

    // -------- internal: cache --------

    private async tryCacheGet(key: string): Promise<HeatmapResponseDto | null> {
        try {
            const raw = await this.redis.get(key);
            if (!raw) return null;
            // JSON.parse внешнего unknown — обрабатываем как plain object,
            // shape совпадает с HeatmapResponseDto при наших set'ах.
            return JSON.parse(raw) as HeatmapResponseDto;
        } catch (err) {
            // Cache failure не должен ронять request — логируем и идём в SQL.
            this.logger.warn(`heatmap cache GET failed: ${stringifyError(err)} (key=${key})`);
            return null;
        }
    }

    private async tryCacheSet(key: string, value: HeatmapResponseDto): Promise<void> {
        try {
            // EX = TTL в секундах. setex deprecated в новых ioredis в пользу set+EX.
            await this.redis.set(key, JSON.stringify(value), 'EX', HEATMAP_CACHE_TTL_SECONDS);
        } catch (err) {
            this.logger.warn(`heatmap cache SET failed: ${stringifyError(err)} (key=${key})`);
        }
    }
}

// =============================================================================
// Helpers
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

// Synthetic threshold для risk (0-100, weighted % от ПДК). 50 = «риск выше
// половины эмпирического максимума» — эмпирически совпадает с фронтом
// (water-params.ts mock).
const RISK_PDK = 50;

/**
 * ПДК для heatmap калибровки + статуса. Три варианта:
 * - `single` — числовое ПДК (большинство параметров: iron/manganese/tds/...)
 *   exceedsCount = COUNT(val > pdk), статус = ratio median/pdk.
 * - `range` — диапазон min-max (только pH в текущем СанПиН справочнике).
 *   exceedsCount = COUNT(val < min OR val > max), статус — outside range = bad.
 * - `none` — параметр не нормируется (temperature, electrical_conductivity).
 *   exceedsCount всегда 0, статус всегда 'good' (нет норматива для оценки).
 *
 * `displayValue` — что показать в response DTO как "pdk" (для UI legend).
 * Для range берём верхнюю границу как ориентир, для none — 0 (фронт может
 * рендерить «н/о» для статуса при exceedsPct=0).
 */
type TResolvedPdk =
    | { kind: 'single'; pdk: number; displayValue: number }
    | { kind: 'range'; min: number; max: number; displayValue: number }
    | { kind: 'none'; displayValue: number };

function resolvePdk(param: THeatmapParam): TResolvedPdk {
    if (param === 'risk') {
        return { kind: 'single', pdk: RISK_PDK, displayValue: RISK_PDK };
    }

    const meta = WATER_PARAMS_BY_CODE[param];
    if (!meta || meta.pdk === null) {
        // Не нормируется — temperature, electrical_conductivity. Heatmap всё равно
        // имеет смысл (видеть distribution), но статус всегда 'good' (нет норматива).
        return { kind: 'none', displayValue: 0 };
    }
    if (typeof meta.pdk === 'number') {
        return { kind: 'single', pdk: meta.pdk, displayValue: meta.pdk };
    }
    // Range-type — pH. Verbose match вместо `else` чтобы TS знал shape.
    return {
        kind: 'range',
        min: meta.pdk.min,
        max: meta.pdk.max,
        displayValue: meta.pdk.max,
    };
}

function validateBbox(dto: HeatmapQueryDto): void {
    if (dto.west >= dto.east) {
        throw new BadRequestException(
            `bbox.west (${dto.west}) должен быть < bbox.east (${dto.east})`,
        );
    }
    if (dto.south >= dto.north) {
        throw new BadRequestException(
            `bbox.south (${dto.south}) должен быть < bbox.north (${dto.north})`,
        );
    }
    // Sanity-cap: bbox не больше ~half-globe (~180° lon × 90° lat). Защита от
    // случайного fetch всей БД при опечатке. Реальный prostor-app шлёт МО
    // bbox ~2-3° × 2°, желаем-cap.
    const lonSpan = dto.east - dto.west;
    const latSpan = dto.north - dto.south;
    if (lonSpan > 60 || latSpan > 30) {
        throw new BadRequestException(
            `bbox слишком большой (lon ${lonSpan.toFixed(1)}°, lat ${latSpan.toFixed(1)}°). ` +
                `Максимум 60° lon × 30° lat — для overview всей РФ хватит.`,
        );
    }
}

function buildCacheKey(
    param: THeatmapParam,
    west: number,
    south: number,
    east: number,
    north: number,
    grid: number,
): string {
    // Округляем координаты до 4 знаков (≈11м точность) — иначе cache miss на
    // floating-point дребезг при панораме карты. Grid округляем до 4 знаков
    // тоже (минимум 0.005 — 3 знака достаточно).
    const r = (n: number): string => n.toFixed(4);
    return `heatmap:${param}:${r(west)}:${r(south)}:${r(east)}:${r(north)}:${r(grid)}`;
}

/**
 * Prisma.Sql фрагмент для CASE-выражения «превышает ли value норматив».
 *
 * Возвращает SUM(CASE WHEN ... THEN 1 ELSE 0 END) полностью, готовый к
 * inlining в SELECT через template-tag interpolation.
 *
 * Параметризован через ${...} placeholders — pdk значения не concat'ятся в
 * строку, они идут в driver как $N parameters (защита от SQL injection даже
 * если бы значения приходили от пользователя — у нас они из СанПиН справочника,
 * но pattern всё равно правильный).
 */
function buildExceedsExpr(pdk: TResolvedPdk): Prisma.Sql {
    if (pdk.kind === 'single') {
        return Prisma.sql`SUM(CASE WHEN val > ${pdk.pdk}::float8 THEN 1 ELSE 0 END)`;
    }
    if (pdk.kind === 'range') {
        // Range — out-of-range считается превышением (pH, например, < 6 или > 9).
        return Prisma.sql`SUM(CASE WHEN val < ${pdk.min}::float8 OR val > ${pdk.max}::float8 THEN 1 ELSE 0 END)`;
    }
    // none — нет норматива (temperature, electrical_conductivity), exceeds_count
    // всегда 0. SELECT 0 без агрегации сломает GROUP BY → используем COUNT(NULL)
    // который тоже всегда 0 + agreggate-compatible.
    return Prisma.sql`COUNT(NULL)`;
}

function mapRowsToFeatures(
    rows: TRawRow[],
    param: THeatmapParam,
    pdk: TResolvedPdk,
): HeatmapFeatureDto[] {
    const isRisk = param === 'risk';
    return rows.map((row): HeatmapFeatureDto => {
        const exceedsPct = row.count > 0 ? Math.round((row.exceeds_count / row.count) * 100) : 0;
        const status = statusFor(row.median, pdk, isRisk);

        return {
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [row.cell_lon, row.cell_lat],
            },
            properties: {
                param,
                count: row.count,
                mean: roundToDigits(row.mean, 4),
                median: roundToDigits(row.median, 4),
                p75: roundToDigits(row.p75, 4),
                exceedsCount: row.exceeds_count,
                exceedsPct,
                status,
            },
        };
    });
}

function statusFor(median: number, pdk: TResolvedPdk, isRisk: boolean): THeatmapStatus {
    if (isRisk) {
        // Risk score 0-100. <50 = норма, 50-80 = mid, 80+ = bad.
        if (median < 50) return 'good';
        if (median < 80) return 'mid';
        return 'bad';
    }
    if (pdk.kind === 'none') {
        // Параметр не нормируется (temperature, electrical_conductivity) —
        // нечем калибровать «good vs bad». UI рендерит neutral-цвет.
        return 'good';
    }
    if (pdk.kind === 'range') {
        // Range — внутри диапазона good, наружу — bad. Нет промежуточного «mid».
        return median >= pdk.min && median <= pdk.max ? 'good' : 'bad';
    }
    // single
    const ratio = median / pdk.pdk;
    if (ratio <= 1) return 'good';
    if (ratio <= 2) return 'mid';
    return 'bad';
}

function roundToDigits(value: number, digits: number): number {
    const factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
}

function stringifyError(err: unknown): string {
    if (err instanceof Error) return err.message;
    return typeof err === 'string' ? err : JSON.stringify(err);
}

