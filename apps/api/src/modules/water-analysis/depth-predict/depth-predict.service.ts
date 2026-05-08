import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@slovo/database';
import type Redis from 'ioredis';
import {
    AQUIFER_LAYERS,
    DEPTH_PREDICT_CACHE_TTL_SECONDS,
    DEPTH_PREDICT_DEFAULT_K,
    DEPTH_PREDICT_DEFAULT_RADIUS_KM,
    DEPTH_PREDICT_IDW_SCALE_KM,
    DEPTH_PREDICT_RECENCY_HALF_LIFE_YEARS,
    DEPTH_PREDICT_REDIS_TOKEN,
    type TDepthPredictIntakeFilter,
} from '../water-analysis.constants';
import {
    ageInYears,
    computeMostLikelyAquiferLayer,
    medianOfDistances,
    percentile,
    roundTo,
    stringifyError,
} from '../_shared';
import type { DepthPredictQueryDto } from './dto/depth-predict.request.dto';
import type {
    AquiferLayerCountDto,
    DepthEstimateDto,
    DepthPredictResponseDto,
} from './dto/depth-predict.response.dto';

// =============================================================================
// DepthPredictService — kNN-прогноз глубины бурения для нового адреса (USP-4).
//
// Pipeline аналогичен PredictService но aggregation поверх depth_meters:
//   1. Cache lookup по rounded coords + intakeType + k + radiusKm
//   2. SQL: top-K ближайших wells/well_dug в радиусе (intakeType фильтр).
//   3. TS aggregation: distance + recency weighted median + percentile intervals
//      (P10/P25/P50/P75/P90) + min/max + layer distribution.
//   4. Cache set TTL 5 мин.
//
// Interval-first response: точная глубина бурения непредсказуема (PhD interval
// analysis), отдаём `interval [P10, P90]` 80% / `iqr [P25, P75]` 50% /
// `hardRange [min, max]` 100% + pointEstimate (median) как UI marker.
// =============================================================================

@Injectable()
export class DepthPredictService {
    private readonly logger = new Logger(DepthPredictService.name);

    constructor(
        private readonly prisma: PrismaService,
        @Inject(DEPTH_PREDICT_REDIS_TOKEN) private readonly redis: Redis,
    ) {}

    async predict(dto: DepthPredictQueryDto): Promise<DepthPredictResponseDto> {
        const k = dto.k ?? DEPTH_PREDICT_DEFAULT_K;
        const radiusKm = dto.radiusKm ?? DEPTH_PREDICT_DEFAULT_RADIUS_KM;
        const intakeType: TDepthPredictIntakeFilter = dto.intakeType ?? 'well';
        const cacheKey = buildCacheKey(dto.lat, dto.lon, k, radiusKm, intakeType);

        // t0 ловим до cache GET — см. heatmap.service rationale.
        const t0 = Date.now();

        const cached = await this.tryCacheGet(cacheKey);
        if (cached) {
            return { ...cached, cached: true, timeTakenMs: Date.now() - t0 };
        }

        const rows = await this.fetchNeighbors(dto.lat, dto.lon, radiusKm, k, intakeType);
        const timeTakenMs = Date.now() - t0;

        const today = new Date();
        const estimate = computeDepthEstimate(rows, today);
        const layerDistribution = computeLayerDistribution(rows);
        const aquiferLayer = computeMostLikelyAquiferLayer(rows.map((r) => r.depth));

        const response: DepthPredictResponseDto = {
            predicted: estimate,
            layerDistribution,
            nNeighbors: rows.length,
            medianDistKm: roundTo(medianOfDistances(rows.map((r) => r.dist_km)), 2),
            intakeType,
            radiusKm,
            insufficientData: estimate === null,
            timeTakenMs,
            cached: false,
        };
        if (aquiferLayer) {
            response.mostLikelyAquiferLayer = aquiferLayer;
        }

        // fire-and-forget: tryCacheSet логирует cache-set ошибки внутри.
        void this.tryCacheSet(cacheKey, response);

        return response;
    }

    private async fetchNeighbors(
        lat: number,
        lon: number,
        radiusKm: number,
        k: number,
        intakeType: TDepthPredictIntakeFilter,
    ): Promise<TNeighborRow[]> {
        const intakeFilter = this.buildIntakeFilter(intakeType);

        return this.prisma.$queryRaw<TNeighborRow[]>`
            SELECT
                depth_meters::float8 AS depth,
                intake_type::text AS intake_type,
                sample_date,
                ST_Distance(
                    geo_point,
                    ST_SetSRID(ST_MakePoint(${lon}::float8, ${lat}::float8), 4326)::geography
                )::float8 / 1000.0 AS dist_km
            FROM water_analysis
            WHERE
                geo_point IS NOT NULL
                AND depth_meters IS NOT NULL
                AND ${intakeFilter}
                AND ST_DWithin(
                    geo_point,
                    ST_SetSRID(ST_MakePoint(${lon}::float8, ${lat}::float8), 4326)::geography,
                    ${radiusKm}::float8 * 1000.0
                )
            ORDER BY dist_km ASC
            LIMIT ${k}
        `;
    }

    private buildIntakeFilter(intakeType: TDepthPredictIntakeFilter): Prisma.Sql {
        if (intakeType === 'well') {
            return Prisma.sql`intake_type = 'well'`;
        }
        if (intakeType === 'well_dug') {
            return Prisma.sql`intake_type = 'well_dug'`;
        }
        return Prisma.sql`intake_type IN ('well', 'well_dug')`;
    }

    private async tryCacheGet(key: string): Promise<DepthPredictResponseDto | null> {
        try {
            const raw = await this.redis.get(key);
            if (!raw) return null;
            return JSON.parse(raw) as DepthPredictResponseDto;
        } catch (err) {
            this.logger.warn(`depth-predict cache GET failed: ${stringifyError(err)} (key=${key})`);
            return null;
        }
    }

    private async tryCacheSet(key: string, value: DepthPredictResponseDto): Promise<void> {
        try {
            await this.redis.set(key, JSON.stringify(value), 'EX', DEPTH_PREDICT_CACHE_TTL_SECONDS);
        } catch (err) {
            this.logger.warn(`depth-predict cache SET failed: ${stringifyError(err)} (key=${key})`);
        }
    }
}

// =============================================================================
// Types + helpers
// =============================================================================

type TNeighborRow = {
    depth: number;
    intake_type: string;
    sample_date: Date;
    dist_km: number;
};

/**
 * Interval-валюированный прогноз. null если нет соседей с глубиной.
 */
function computeDepthEstimate(rows: TNeighborRow[], today: Date): DepthEstimateDto | null {
    if (rows.length === 0) return null;

    const sorted = [...rows].map((r) => r.depth).sort((a, b) => a - b);

    // Weighted median через distance + recency. Не используем sorted[mid] потому
    // что хотим свежим/ближним соседям больше веса.
    let weightedSumValues = 0;
    let weightedSumWeights = 0;
    for (const row of rows) {
        const distWeight = 1 / (1 + row.dist_km / DEPTH_PREDICT_IDW_SCALE_KM);
        const ageYears = ageInYears(today, row.sample_date);
        const recencyWeight = Math.exp(-ageYears / DEPTH_PREDICT_RECENCY_HALF_LIFE_YEARS);
        const weight = distWeight * recencyWeight;
        weightedSumValues += row.depth * weight;
        weightedSumWeights += weight;
    }
    const pointEstimate = weightedSumWeights > 0 ? weightedSumValues / weightedSumWeights : sorted[0];

    return {
        interval: {
            lower: roundTo(percentile(sorted, 0.1), 1),
            upper: roundTo(percentile(sorted, 0.9), 1),
            confidence: 80,
        },
        iqr: {
            lower: roundTo(percentile(sorted, 0.25), 1),
            upper: roundTo(percentile(sorted, 0.75), 1),
            confidence: 50,
        },
        hardRange: {
            lower: roundTo(sorted[0], 1),
            upper: roundTo(sorted[sorted.length - 1], 1),
            confidence: 100,
        },
        pointEstimate: roundTo(pointEstimate, 1),
        n: rows.length,
    };
}

function computeLayerDistribution(rows: TNeighborRow[]): AquiferLayerCountDto[] {
    const total = rows.length;
    return AQUIFER_LAYERS.map((layer) => {
        const count = rows.filter((r) => r.depth >= layer.min && r.depth < layer.max).length;
        return {
            id: layer.id,
            label: layer.label,
            count,
            pct: total > 0 ? Math.round((count / total) * 100) : 0,
        };
    });
}

function buildCacheKey(
    lat: number,
    lon: number,
    k: number,
    radiusKm: number,
    intakeType: TDepthPredictIntakeFilter,
): string {
    const r = (n: number): string => n.toFixed(3);
    return `depth-predict:${intakeType}:${r(lat)}:${r(lon)}:${k}:${r(radiusKm)}`;
}
