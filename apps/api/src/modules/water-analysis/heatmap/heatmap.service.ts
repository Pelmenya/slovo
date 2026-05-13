import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@slovo/database';
import { WATER_PARAMS_BY_CODE } from '@slovo/water-blank-extraction';
import { Prisma } from '@prisma/client';
import type Redis from 'ioredis';
import {
    COVERAGE_DENSE_COUNT,
    COVERAGE_MID_COUNT,
    GRID_DEFAULT_DEG,
    HEATMAP_CACHE_TTL_SECONDS,
    HEATMAP_REDIS_TOKEN,
    WATER_ANALYSIS_CACHE_VERSION,
    type THeatmapParam,
} from '../water-analysis.constants';
import { roundTo, stringifyError, validateBbox } from '../_shared';
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
//   4. Synthetic params:
//      - `risk` — weighted % от ПДК по 4 ключевым параметрам (та же формула
//        что в derived 05-normalize.ts).
//      - `all_problems` — % строк в cell где хотя бы один нормируемый param
//        превышает ПДК (max severity OR-aggregation). UX «все проблемы видно».
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

        // t0 ловим до cache GET — на cache-hit получим honest «сколько user
        // ждал» (включая Redis GET round-trip), не закешированное старое
        // SQL-время. Иначе observability показывает misleading «100мс» когда
        // реально 1мс из cache.
        const t0 = Date.now();

        const cached = await this.tryCacheGet(cacheKey);
        if (cached) {
            return { ...cached, cached: true, timeTakenMs: Date.now() - t0 };
        }

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

        // Cache asynchronously — fire-and-forget. tryCacheSet логирует ошибки
        // через warn внутри (см. _shared/redis-provider rationale + ниже).
        // `void` явно signals «не ждём результата», observability через
        // отдельный health-check Redis (memory `project_tech_debt`).
        void this.tryCacheSet(cacheKey, response);

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
        if (param === 'all_problems') {
            return this.runAllProblemsQuery(dto, grid);
        }
        if (param === 'coverage') {
            return this.runCoverageQuery(dto, grid);
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
        // COALESCE(params_canonical, params) — Slice 4.2.5a canonical override.
        // 2335 ордеров имеют merged Docling params (1205 Vision→Docling overrides,
        // 987 из них изменили exceedsPdk-статус). Существующий jsonb existence
        // operator `?` работает с COALESCE — если canonical присутствует, читаем
        // его; иначе fallback на existing Vision params.
        return this.prisma.$queryRaw<TRawRow[]>`
            WITH bounded AS (
                SELECT
                    geo_point::geometry AS geom,
                    COALESCE(params_canonical, params) AS params
                FROM water_analysis
                WHERE
                    geo_point IS NOT NULL
                    AND geo_point && ST_MakeEnvelope(
                        ${dto.west}::float8, ${dto.south}::float8,
                        ${dto.east}::float8, ${dto.north}::float8, 4326
                    )::geography
                    AND COALESCE(params_canonical, params) ? ${param}
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

    private async runCoverageQuery(
        dto: HeatmapQueryDto,
        grid: number,
    ): Promise<TRawRow[]> {
        // Coverage = dataset density. Не фильтруем по params (нет ПДК для
        // density), просто COUNT cells. На фронте — grey-scale heatmap «где
        // данные есть, где нет». Wow для демо: «мы покрыли весь МО».
        //
        // mean/median/p75 для density семантически = count (для compatibility
        // с frontend response shape). exceedsPct=0 (нет concept «exceedance»
        // для coverage). Status — по count thresholds через statusFor.
        return this.prisma.$queryRaw<TRawRow[]>`
            WITH bounded AS (
                SELECT geo_point::geometry AS geom
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
                    FLOOR(ST_Y(geom) / ${grid}::float8) * ${grid}::float8 + ${grid}::float8 / 2 AS cell_lat
                FROM bounded
            )
            SELECT
                cell_lon::float8 AS cell_lon,
                cell_lat::float8 AS cell_lat,
                COUNT(*)::int AS count,
                COUNT(*)::float8 AS mean,
                COUNT(*)::float8 AS median,
                COUNT(*)::float8 AS p75,
                0::int AS exceeds_count
            FROM extracted
            GROUP BY cell_lon, cell_lat
            HAVING COUNT(*) >= 1
        `;
    }

    private async runAllProblemsQuery(
        dto: HeatmapQueryDto,
        grid: number,
    ): Promise<TRawRow[]> {
        // OR-aggregation: для каждого row проверяем все regulated paramы из
        // СанПиН справочника. Если хотя бы один > ПДК (или out-of-range для pH) —
        // row помечается has_exceedance=true. Per cell exceedsPct = % таких rows.
        //
        // Source of truth для list paramов + ПДК — `WATER_PARAMS_BY_CODE` из
        // `@slovo/water-blank-extraction` (СанПиН 1.2.3685-21 v1.0.0). При
        // изменениях справочника SQL автоматически подтянет новые params без
        // правки этого файла.
        //
        // COALESCE(... > pdk, false) — params->>code returns NULL если param
        // отсутствует в записи; numeric comparison к NULL = NULL → COALESCE на
        // false. Это значит «нет данных = не считаем нарушением» — правильное
        // поведение, иначе записи без iron_total автоматически считались бы
        // problematic.
        const anyExceedanceExpr = buildAnyExceedanceExpr();

        // COALESCE canonical override — см. runParamQuery rationale.
        return this.prisma.$queryRaw<TRawRow[]>`
            WITH bounded AS (
                SELECT
                    geo_point::geometry AS geom,
                    COALESCE(params_canonical, params) AS params
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
                    CASE WHEN (${anyExceedanceExpr}) THEN 1 ELSE 0 END AS has_exceedance
                FROM bounded
            )
            SELECT
                cell_lon::float8 AS cell_lon,
                cell_lat::float8 AS cell_lat,
                COUNT(*)::int AS count,
                -- Для composite параметра mean/median/p75 семантически = exceedsPct
                -- (binary aggregation: AVG of 0/1 * 100 = % rows с exceedance).
                -- Это позволяет statusFor использовать тот же median path как для
                -- single/range params, а frontend получить consistent shape.
                (AVG(has_exceedance::float8) * 100)::float8 AS mean,
                (AVG(has_exceedance::float8) * 100)::float8 AS median,
                (AVG(has_exceedance::float8) * 100)::float8 AS p75,
                SUM(has_exceedance)::int AS exceeds_count
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
        // COALESCE canonical override — см. runParamQuery rationale.
        return this.prisma.$queryRaw<TRawRow[]>`
            WITH bounded AS (
                SELECT
                    geo_point::geometry AS geom,
                    COALESCE(params_canonical, params) AS params
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

// all_problems thresholds — % rows в cell с exceedance хотя бы одного param.
// 30/60 эмпирически: cells с <30% rows problematic = здоровый район;
// 30-60% = смешанный; 60+ = массовая проблема. UX-friendly для overview.
const ALL_PROBLEMS_MID_PCT = 30;
const ALL_PROBLEMS_BAD_PCT = 60;

/**
 * ПДК для heatmap калибровки + статуса. Четыре варианта:
 * - `single` — числовое ПДК (большинство параметров: iron/manganese/tds/...)
 *   exceedsCount = COUNT(val > pdk), статус = ratio median/pdk.
 * - `range` — диапазон min-max (только pH в текущем СанПиН справочнике).
 *   exceedsCount = COUNT(val < min OR val > max), статус — outside range = bad.
 * - `none` — параметр не нормируется (temperature, electrical_conductivity).
 *   exceedsCount всегда 0, статус всегда 'good' (нет норматива для оценки).
 * - `composite` — synthetic `all_problems`: % rows с exceedance хотя бы одного
 *   regulated paramа. exceedsCount = COUNT таких rows, статус — по
 *   percentage thresholds (30/60).
 *
 * `displayValue` — что показать в response DTO как "pdk" (для UI legend).
 * Для range берём верхнюю границу как ориентир, для none — 0 (фронт может
 * рендерить «н/о» для статуса при exceedsPct=0). Для composite — пороговый
 * процент (30) для UI legend «жёлтая зона начинается на 30%».
 */
type TResolvedPdk =
    | { kind: 'single'; pdk: number; displayValue: number }
    | { kind: 'range'; min: number; max: number; displayValue: number }
    | { kind: 'none'; displayValue: number }
    | { kind: 'composite'; midPct: number; badPct: number; displayValue: number }
    | { kind: 'density'; midCount: number; denseCount: number; displayValue: number };

function resolvePdk(param: THeatmapParam): TResolvedPdk {
    if (param === 'risk') {
        return { kind: 'single', pdk: RISK_PDK, displayValue: RISK_PDK };
    }
    if (param === 'all_problems') {
        return {
            kind: 'composite',
            midPct: ALL_PROBLEMS_MID_PCT,
            badPct: ALL_PROBLEMS_BAD_PCT,
            displayValue: ALL_PROBLEMS_MID_PCT,
        };
    }
    if (param === 'coverage') {
        return {
            kind: 'density',
            midCount: COVERAGE_MID_COUNT,
            denseCount: COVERAGE_DENSE_COUNT,
            displayValue: COVERAGE_DENSE_COUNT,
        };
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
    return `heatmap:${WATER_ANALYSIS_CACHE_VERSION}:${param}:${r(west)}:${r(south)}:${r(east)}:${r(north)}:${r(grid)}`;
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
    // none/composite — `runParamQuery` сюда не дойдёт для composite (диспатч
    // в `runAllProblemsQuery` раньше). Для none нет норматива (temperature,
    // electrical_conductivity), exceeds_count всегда 0. SELECT 0 без агрегации
    // сломает GROUP BY → используем COUNT(NULL) (тоже всегда 0, aggregate-compatible).
    return Prisma.sql`COUNT(NULL)`;
}

/**
 * Boolean SQL expression «у этого row превышен хотя бы один regulated paramу».
 *
 * Динамически собирается из `WATER_PARAMS_BY_CODE` (СанПиН справочник) — при
 * изменениях справочника SQL автоматически подтягивает новые paramы без
 * правки этого кода. Используется в `runAllProblemsQuery` для composite
 * 'all_problems' paramа.
 *
 * SQL pattern per paramу:
 *   - single ПДК (iron 0.3): `COALESCE((params->>'iron_total')::numeric > 0.3, false)`
 *   - range ПДК (pH 6-9):
 *     `COALESCE((params->>'ph')::numeric < 6, false) OR
 *      COALESCE((params->>'ph')::numeric > 9, false)`
 *
 * COALESCE(..., false) — params->>'key' возвращает NULL для отсутствующих
 * paramов. Numeric comparison к NULL = NULL → COALESCE на false. Это значит
 * «нет данных = не считаем нарушением» (correct: записи без iron_total не
 * должны автоматически считаться problematic).
 *
 * Все ПДК-значения идут как $N params (Prisma.sql interpolation), не concat —
 * SQL injection невозможна даже теоретически (значения из const справочника,
 * но pattern правильный).
 */
function buildAnyExceedanceExpr(): Prisma.Sql {
    const checks: Prisma.Sql[] = [];
    for (const meta of Object.values(WATER_PARAMS_BY_CODE)) {
        if (!meta.regulated || meta.pdk === null) continue;
        const code = meta.paramCode;
        if (typeof meta.pdk === 'number') {
            checks.push(
                Prisma.sql`COALESCE((params->>${code})::numeric > ${meta.pdk}::numeric, false)`,
            );
        } else {
            checks.push(
                Prisma.sql`(COALESCE((params->>${code})::numeric < ${meta.pdk.min}::numeric, false) OR COALESCE((params->>${code})::numeric > ${meta.pdk.max}::numeric, false))`,
            );
        }
    }
    if (checks.length === 0) {
        // Defensive: если справочник пуст (не должно случиться) — `false`
        // → has_exceedance всегда 0 → all cells с exceedsPct=0 (good).
        return Prisma.sql`false`;
    }
    return Prisma.join(checks, ' OR ');
}

function mapRowsToFeatures(
    rows: TRawRow[],
    param: THeatmapParam,
    pdk: TResolvedPdk,
): HeatmapFeatureDto[] {
    const isRisk = param === 'risk';
    return rows.map((row): HeatmapFeatureDto => {
        const exceedsPct = row.count > 0 ? Math.round((row.exceeds_count / row.count) * 100) : 0;
        const status = statusFor(row.median, exceedsPct, pdk, isRisk);

        return {
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [row.cell_lon, row.cell_lat],
            },
            properties: {
                param,
                count: row.count,
                mean: roundTo(row.mean, 4),
                median: roundTo(row.median, 4),
                p75: roundTo(row.p75, 4),
                exceedsCount: row.exceeds_count,
                exceedsPct,
                status,
            },
        };
    });
}

function statusFor(
    median: number,
    exceedsPct: number,
    pdk: TResolvedPdk,
    isRisk: boolean,
): THeatmapStatus {
    if (isRisk) {
        // Risk score 0-100. <50 = норма, 50-80 = mid, 80+ = bad.
        if (median < 50) return 'good';
        if (median < 80) return 'mid';
        return 'bad';
    }
    if (pdk.kind === 'composite') {
        // all_problems: status по % rows в cell с exceedance.
        if (exceedsPct < pdk.midPct) return 'good';
        if (exceedsPct < pdk.badPct) return 'mid';
        return 'bad';
    }
    if (pdk.kind === 'density') {
        // coverage: status по count анализов в cell. Sparse (1-5) = good
        // (хоть какие-то данные есть), medium (6-15) = mid, dense (16+) = bad.
        // На фронте «bad» в grey-scale значит «много данных» — не плохо, а
        // intense — это design choice (frontend интерпретирует свой palette).
        if (median < pdk.midCount) return 'good';
        if (median < pdk.denseCount) return 'mid';
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

