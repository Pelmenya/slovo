import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@slovo/database';
import type Redis from 'ioredis';
import {
    AQUIFER_LAYERS,
    DEPTH_MAP_CACHE_TTL_SECONDS,
    DEPTH_MAP_REDIS_TOKEN,
    GRID_DEFAULT_DEG,
    WATER_ANALYSIS_CACHE_VERSION,
} from '../water-analysis.constants';
import { roundTo, stringifyError, type TIntakeTypeFilter, validateBbox } from '../_shared';
import type { DepthMapQueryDto } from './dto/depth-map.request.dto';
import type {
    AquiferLayerCountDto,
    DepthMapCellPropertiesDto,
    DepthMapFeatureDto,
    DepthMapResponseDto,
} from './dto/depth-map.response.dto';

// =============================================================================
// DepthMapService — карта глубин скважин/колодцев по grid (USP-4 base).
//
// Аналогично HeatmapService, но aggregation поверх `depth_meters` column
// (не jsonb). Per cell:
//   - count, median, P25, P75, min, max глубины
//   - 5 buckets распределения по водоносным горизонтам (AQUIFER_LAYERS)
//   - dominantLayerId (наиболее представленный горизонт)
//   - pctWell (доля скважин-vs-колодцев)
//
// Audience: B2B drilling-сегмент. Coverage: well 76.7% (7 884), well_dug 41.2% (742).
// =============================================================================

@Injectable()
export class DepthMapService {
    private readonly logger = new Logger(DepthMapService.name);

    constructor(
        private readonly prisma: PrismaService,
        @Inject(DEPTH_MAP_REDIS_TOKEN) private readonly redis: Redis,
    ) {}

    async query(dto: DepthMapQueryDto): Promise<DepthMapResponseDto> {
        validateBbox(dto);

        const grid = dto.grid ?? GRID_DEFAULT_DEG;
        const intakeType = dto.intakeType ?? 'all';
        const cacheKey = buildCacheKey(intakeType, dto.west, dto.south, dto.east, dto.north, grid);

        // t0 ловим до cache GET — см. heatmap.service rationale.
        const t0 = Date.now();

        const cached = await this.tryCacheGet(cacheKey);
        if (cached) {
            return { ...cached, cached: true, timeTakenMs: Date.now() - t0 };
        }

        const rows = await this.runQuery(intakeType, dto, grid);
        const timeTakenMs = Date.now() - t0;

        const features = mapRowsToFeatures(rows);
        const response: DepthMapResponseDto = {
            type: 'FeatureCollection',
            features,
            intakeType,
            grid,
            timeTakenMs,
            cached: false,
        };

        // fire-and-forget: tryCacheSet логирует cache-set ошибки внутри.
        void this.tryCacheSet(cacheKey, response);

        return response;
    }

    private async runQuery(
        intakeType: TIntakeTypeFilter,
        dto: DepthMapQueryDto,
        grid: number,
    ): Promise<TRawRow[]> {
        // intakeType filter — `all` означает well + well_dug (municipal/spring/river
        // depth не имеет смысла, отфильтрованы через `depth_meters IS NOT NULL`
        // как защитный layer + явный intake_type IN clause).
        //
        // Sub-aggregations в одном SQL: median/p25/p75/min/max + 5 bucket counts
        // + well_count для pctWell. Делаем всё в одном GROUP BY чтобы не возвращаться
        // в БД 6 раз — дороже latency.
        const intakeFilter = this.buildIntakeFilter(intakeType);

        return this.prisma.$queryRaw<TRawRow[]>`
            WITH bounded AS (
                SELECT
                    geo_point::geometry AS geom,
                    depth_meters::float8 AS depth,
                    intake_type::text AS intake_type
                FROM water_analysis
                WHERE
                    geo_point IS NOT NULL
                    AND depth_meters IS NOT NULL
                    AND ${intakeFilter}
                    AND geo_point && ST_MakeEnvelope(
                        ${dto.west}::float8, ${dto.south}::float8,
                        ${dto.east}::float8, ${dto.north}::float8, 4326
                    )::geography
            ),
            extracted AS (
                SELECT
                    FLOOR(ST_X(geom) / ${grid}::float8) * ${grid}::float8 + ${grid}::float8 / 2 AS cell_lon,
                    FLOOR(ST_Y(geom) / ${grid}::float8) * ${grid}::float8 + ${grid}::float8 / 2 AS cell_lat,
                    depth,
                    intake_type
                FROM bounded
            )
            SELECT
                cell_lon::float8 AS cell_lon,
                cell_lat::float8 AS cell_lat,
                COUNT(*)::int AS count,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY depth)::float8 AS median,
                PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY depth)::float8 AS p25,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY depth)::float8 AS p75,
                MIN(depth)::float8 AS min_depth,
                MAX(depth)::float8 AS max_depth,
                SUM(CASE WHEN depth >= 0 AND depth < 15 THEN 1 ELSE 0 END)::int AS layer_top_water,
                SUM(CASE WHEN depth >= 15 AND depth < 50 THEN 1 ELSE 0 END)::int AS layer_sandy,
                SUM(CASE WHEN depth >= 50 AND depth < 100 THEN 1 ELSE 0 END)::int AS layer_sandy_limestone,
                SUM(CASE WHEN depth >= 100 AND depth < 200 THEN 1 ELSE 0 END)::int AS layer_limestone,
                SUM(CASE WHEN depth >= 200 THEN 1 ELSE 0 END)::int AS layer_artesian,
                SUM(CASE WHEN intake_type = 'well' THEN 1 ELSE 0 END)::int AS well_count
            FROM extracted
            GROUP BY cell_lon, cell_lat
            HAVING COUNT(*) >= 3
        `;
    }
    // ^^^ HAVING >= 3: 3-anonymity guard для drilling-данных. Глубина+coord
    // даёт participant fingerprint участка; security-auditor 2026-05-08 указал
    // что count=1-2 пропускают идентификацию даже при grid 0.02°. Cells <3
    // молча пропускаются (UI: пустая зона).

    /**
     * Prisma.Sql фрагмент для intake_type фильтра. Возвращается как готовый
     * boolean expression вставляемый в WHERE через template-tag interpolation.
     */
    private buildIntakeFilter(intakeType: TIntakeTypeFilter): Prisma.Sql {
        if (intakeType === 'well') {
            return Prisma.sql`intake_type = 'well'`;
        }
        if (intakeType === 'well_dug') {
            return Prisma.sql`intake_type = 'well_dug'`;
        }
        // 'all' — оба типа (depth_meters IS NOT NULL уже выше отфильтровывает municipal/spring/river)
        return Prisma.sql`intake_type IN ('well', 'well_dug')`;
    }

    private async tryCacheGet(key: string): Promise<DepthMapResponseDto | null> {
        try {
            const raw = await this.redis.get(key);
            if (!raw) return null;
            return JSON.parse(raw) as DepthMapResponseDto;
        } catch (err) {
            this.logger.warn(`depth-map cache GET failed: ${stringifyError(err)} (key=${key})`);
            return null;
        }
    }

    private async tryCacheSet(key: string, value: DepthMapResponseDto): Promise<void> {
        try {
            await this.redis.set(key, JSON.stringify(value), 'EX', DEPTH_MAP_CACHE_TTL_SECONDS);
        } catch (err) {
            this.logger.warn(`depth-map cache SET failed: ${stringifyError(err)} (key=${key})`);
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

function buildCacheKey(
    intakeType: TIntakeTypeFilter,
    west: number,
    south: number,
    east: number,
    north: number,
    grid: number,
): string {
    const r = (n: number): string => n.toFixed(4);
    return `depth-map:${WATER_ANALYSIS_CACHE_VERSION}:${intakeType}:${r(west)}:${r(south)}:${r(east)}:${r(north)}:${r(grid)}`;
}

function mapRowsToFeatures(rows: TRawRow[]): DepthMapFeatureDto[] {
    return rows.map((row): DepthMapFeatureDto => {
        const layerCounts: Record<string, number> = {
            top_water: row.layer_top_water,
            sandy: row.layer_sandy,
            sandy_limestone: row.layer_sandy_limestone,
            limestone: row.layer_limestone,
            artesian: row.layer_artesian,
        };

        // 5 buckets всегда — даже пустые (count=0) для UI bar-chart consistency.
        const aquiferLayers: AquiferLayerCountDto[] = AQUIFER_LAYERS.map((layer) => {
            const cnt = layerCounts[layer.id] ?? 0;
            return {
                id: layer.id,
                label: layer.label,
                count: cnt,
                pct: row.count > 0 ? Math.round((cnt / row.count) * 100) : 0,
            };
        });

        // Dominant layer — с максимальным count. Tie-breaker — порядок AQUIFER_LAYERS
        // (мелкие первыми) — стабильный без явного sort.
        const dominantLayerId =
            aquiferLayers.reduce((best, cur) => (cur.count > best.count ? cur : best))?.id ?? 'sandy';

        const pctWell = row.count > 0 ? Math.round((row.well_count / row.count) * 100) : 0;

        const properties: DepthMapCellPropertiesDto = {
            count: row.count,
            median: roundTo(row.median, 1),
            p25: roundTo(row.p25, 1),
            p75: roundTo(row.p75, 1),
            minDepth: roundTo(row.min_depth, 1),
            maxDepth: roundTo(row.max_depth, 1),
            aquiferLayers,
            dominantLayerId,
            pctWell,
        };

        return {
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [row.cell_lon, row.cell_lat],
            },
            properties,
        };
    });
}

