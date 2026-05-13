import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@slovo/database';
import type Redis from 'ioredis';
import {
    POINTS_CACHE_TTL_SECONDS,
    POINTS_COORD_ROUND_GRID,
    POINTS_DEFAULT_LIMIT,
    POINTS_REDIS_TOKEN,
} from '../water-analysis.constants';
import { stringifyError, validateBbox } from '../_shared';
import type { PointsQueryDto } from './dto/points.request.dto';
import type {
    PointFeatureDto,
    PointPropertiesDto,
    PointsResponseDto,
} from './dto/points.response.dto';

// =============================================================================
// PointsService — отдельные анализы в bbox для high-zoom детализации карты.
//
// Pipeline:
//   1. Cache lookup по bbox+limit
//   2. Prisma raw SQL: bbox-фильтр через PostGIS && (GIST), ORDER BY sample_date
//      DESC LIMIT N+1 (N+1 чтобы определить truncated flag)
//   3. Round coordinates до 0.005° (~500м) для PII protection (см. memory
//      `feedback_water_heatmap_pii_strategy`)
//   4. Compute risk score per point (та же формула что в /heatmap risk)
//   5. Build GeoJSON FeatureCollection
// =============================================================================

@Injectable()
export class PointsService {
    private readonly logger = new Logger(PointsService.name);

    constructor(
        private readonly prisma: PrismaService,
        @Inject(POINTS_REDIS_TOKEN) private readonly redis: Redis,
    ) {}

    async query(dto: PointsQueryDto): Promise<PointsResponseDto> {
        validateBbox(dto);

        const limit = dto.limit ?? POINTS_DEFAULT_LIMIT;
        const cacheKey = buildCacheKey(dto.west, dto.south, dto.east, dto.north, limit);

        // t0 ловим до cache GET — см. heatmap.service rationale.
        const t0 = Date.now();

        const cached = await this.tryCacheGet(cacheKey);
        if (cached) {
            return { ...cached, cached: true, timeTakenMs: Date.now() - t0 };
        }

        // LIMIT+1 чтобы определить есть ли ещё точки (для truncated флага)
        const rows = await this.fetchPoints(dto, limit + 1);
        const timeTakenMs = Date.now() - t0;

        const truncated = rows.length > limit;
        const visibleRows = truncated ? rows.slice(0, limit) : rows;
        const features = visibleRows.map(mapRowToFeature);

        const response: PointsResponseDto = {
            type: 'FeatureCollection',
            features,
            count: features.length,
            truncated,
            limit,
            timeTakenMs,
            cached: false,
        };

        // fire-and-forget: tryCacheSet логирует cache-set ошибки внутри.
        void this.tryCacheSet(cacheKey, response);

        return response;
    }

    private async fetchPoints(dto: PointsQueryDto, fetchLimit: number): Promise<TPointRow[]> {
        // order_number из БД НЕ селектим — это PII join-key к Bitrix24/CRM-aqua.
        // См. PointPropertiesDto комментарий и security-auditor 2026-05-08.
        //
        // COALESCE(params_canonical, params) — Slice 4.2.5a canonical override.
        // На high-zoom popup юзер должен видеть точные Docling-corrected
        // значения вместо Vision-hallucinated.
        return this.prisma.$queryRaw<TPointRow[]>`
            SELECT
                intake_type::text AS intake_type,
                depth_meters,
                sample_date,
                region,
                locality,
                COALESCE(params_canonical, params) AS params,
                ST_X(geo_point::geometry)::float8 AS lon,
                ST_Y(geo_point::geometry)::float8 AS lat
            FROM water_analysis
            WHERE
                geo_point IS NOT NULL
                AND geo_point && ST_MakeEnvelope(
                    ${dto.west}::float8, ${dto.south}::float8,
                    ${dto.east}::float8, ${dto.north}::float8, 4326
                )::geography
            ORDER BY sample_date DESC
            LIMIT ${fetchLimit}
        `;
    }

    private async tryCacheGet(key: string): Promise<PointsResponseDto | null> {
        try {
            const raw = await this.redis.get(key);
            if (!raw) return null;
            return JSON.parse(raw) as PointsResponseDto;
        } catch (err) {
            this.logger.warn(`points cache GET failed: ${stringifyError(err)} (key=${key})`);
            return null;
        }
    }

    private async tryCacheSet(key: string, value: PointsResponseDto): Promise<void> {
        try {
            await this.redis.set(key, JSON.stringify(value), 'EX', POINTS_CACHE_TTL_SECONDS);
        } catch (err) {
            this.logger.warn(`points cache SET failed: ${stringifyError(err)} (key=${key})`);
        }
    }
}

// =============================================================================
// Helpers
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

function buildCacheKey(
    west: number,
    south: number,
    east: number,
    north: number,
    limit: number,
): string {
    const r = (n: number): string => n.toFixed(4);
    return `points:${r(west)}:${r(south)}:${r(east)}:${r(north)}:${limit}`;
}

/**
 * Round до 0.005° (~500м) для PII obfuscation. Та же стратегия что в
 * `/similar` (similar.service.ts). Для точечных responses (не агрегатов)
 * это primary защита от dom-identification.
 */
function roundCoord(value: number): number {
    return Math.round(value * POINTS_COORD_ROUND_GRID) / POINTS_COORD_ROUND_GRID;
}

function mapRowToFeature(row: TPointRow): PointFeatureDto {
    const params = sanitizeParams(row.params);
    const risk = computeRisk(params);

    const properties: PointPropertiesDto = {
        intakeType: row.intake_type,
        depthMeters: row.depth_meters,
        sampleDate: row.sample_date.toISOString().slice(0, 10),
        region: row.region,
        locality: row.locality,
        params,
        risk,
    };

    return {
        type: 'Feature',
        geometry: {
            type: 'Point',
            coordinates: [roundCoord(row.lon), roundCoord(row.lat)],
        },
        properties,
    };
}

/**
 * jsonb может прийти с любыми типами в значениях (хотя нашими ingest-скриптами
 * мы пишем только number'ы). Filter недостоверные значения чтобы UI не падал
 * на string в number-поле.
 */
function sanitizeParams(raw: Record<string, unknown>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [code, value] of Object.entries(raw)) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            out[code] = value;
        }
    }
    return out;
}

/**
 * Risk score (0-100). Та же формула что в /heatmap risk-query — три источника
 * правды (БД-derived / heatmap SQL / points TS) согласованы.
 *
 * null если все 4 ключевых параметра отсутствуют — нечем считать.
 */
function computeRisk(params: Record<string, number>): number | null {
    const hardness = params.hardness_total;
    const iron = params.iron_total;
    const manganese = params.manganese;
    const tds = params.tds;

    const hasAny =
        hardness !== undefined || iron !== undefined || manganese !== undefined || tds !== undefined;
    if (!hasAny) return null;

    const r =
        ((hardness ?? 0) / 7) * 25 +
        ((iron ?? 0) / 0.3) * 25 +
        ((manganese ?? 0) / 0.1) * 25 +
        ((tds ?? 0) / 1000) * 25;
    return Math.round(Math.min(100, r));
}
