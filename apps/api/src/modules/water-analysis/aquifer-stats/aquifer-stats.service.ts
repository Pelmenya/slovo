import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@slovo/database';
import type Redis from 'ioredis';
import {
    AQUIFER_LAYERS,
    AQUIFER_STATS_CACHE_TTL_SECONDS,
    AQUIFER_STATS_REDIS_TOKEN,
    AQUIFER_STATS_SAMPLE_LIMIT,
    type TDepthMapIntakeFilter,
} from '../water-analysis.constants';
import { percentile, roundTo, stringifyError, validateBbox } from '../_shared';
import type { AquiferStatsQueryDto } from './dto/aquifer-stats.request.dto';
import type {
    AquiferLayerStatsDto,
    AquiferStatsResponseDto,
} from './dto/aquifer-stats.response.dto';

// =============================================================================
// AquiferStatsService — стратифицированная статистика по водоносным горизонтам.
//
// Pipeline:
//   1. Cache lookup по bbox + intakeType.
//   2. SQL fetch raw rows: depth + intake_type + params jsonb. ORDER BY sample_date
//      DESC LIMIT AQUIFER_STATS_SAMPLE_LIMIT (5000).
//   3. TS aggregation per AQUIFER_LAYER bucket:
//      - count, pct, medianDepth, pctWell
//      - medianChemistry: для каждого paramCode median values из jsonb
//   4. Build response.
//
// Aggregation в TS (не SQL) потому что 22 параметра × 5 buckets = 110 SQL
// aggregations требуют LATERAL JOIN или огромный CASE-выражение. TS group по
// 5000 точек — миллисекунды, читаемее.
// =============================================================================

@Injectable()
export class AquiferStatsService {
    private readonly logger = new Logger(AquiferStatsService.name);

    constructor(
        private readonly prisma: PrismaService,
        @Inject(AQUIFER_STATS_REDIS_TOKEN) private readonly redis: Redis,
    ) {}

    async query(dto: AquiferStatsQueryDto): Promise<AquiferStatsResponseDto> {
        validateBbox(dto);

        const intakeType: TDepthMapIntakeFilter = dto.intakeType ?? 'all';
        const cacheKey = buildCacheKey(intakeType, dto.west, dto.south, dto.east, dto.north);

        // t0 ловим до cache GET — см. heatmap.service rationale.
        const t0 = Date.now();

        const cached = await this.tryCacheGet(cacheKey);
        if (cached) {
            return { ...cached, cached: true, timeTakenMs: Date.now() - t0 };
        }

        const rows = await this.fetchRows(intakeType, dto);
        const layers = aggregateLayers(rows);
        const dominantLayerId = computeDominantLayerId(layers);
        const totalWells = rows.length;
        const timeTakenMs = Date.now() - t0;

        const response: AquiferStatsResponseDto = {
            layers,
            intakeType,
            totalWells,
            samplesUsed: totalWells,
            dominantLayerId,
            timeTakenMs,
            cached: false,
        };

        // fire-and-forget: tryCacheSet логирует cache-set ошибки внутри.
        void this.tryCacheSet(cacheKey, response);

        return response;
    }

    private async fetchRows(
        intakeType: TDepthMapIntakeFilter,
        dto: AquiferStatsQueryDto,
    ): Promise<TRawRow[]> {
        const intakeFilter = this.buildIntakeFilter(intakeType);

        return this.prisma.$queryRaw<TRawRow[]>`
            SELECT
                depth_meters::float8 AS depth,
                intake_type::text AS intake_type,
                params
            FROM water_analysis
            WHERE
                geo_point IS NOT NULL
                AND depth_meters IS NOT NULL
                AND ${intakeFilter}
                AND geo_point && ST_MakeEnvelope(
                    ${dto.west}::float8, ${dto.south}::float8,
                    ${dto.east}::float8, ${dto.north}::float8, 4326
                )::geography
            ORDER BY sample_date DESC
            LIMIT ${AQUIFER_STATS_SAMPLE_LIMIT}
        `;
    }

    private buildIntakeFilter(intakeType: TDepthMapIntakeFilter): Prisma.Sql {
        if (intakeType === 'well') return Prisma.sql`intake_type = 'well'`;
        if (intakeType === 'well_dug') return Prisma.sql`intake_type = 'well_dug'`;
        return Prisma.sql`intake_type IN ('well', 'well_dug')`;
    }

    private async tryCacheGet(key: string): Promise<AquiferStatsResponseDto | null> {
        try {
            const raw = await this.redis.get(key);
            if (!raw) return null;
            return JSON.parse(raw) as AquiferStatsResponseDto;
        } catch (err) {
            this.logger.warn(`aquifer-stats cache GET failed: ${stringifyError(err)} (key=${key})`);
            return null;
        }
    }

    private async tryCacheSet(key: string, value: AquiferStatsResponseDto): Promise<void> {
        try {
            await this.redis.set(key, JSON.stringify(value), 'EX', AQUIFER_STATS_CACHE_TTL_SECONDS);
        } catch (err) {
            this.logger.warn(`aquifer-stats cache SET failed: ${stringifyError(err)} (key=${key})`);
        }
    }
}

// =============================================================================
// Aggregation logic (TS-side)
// =============================================================================

type TRawRow = {
    depth: number;
    intake_type: string;
    params: Record<string, unknown>;
};

function aggregateLayers(rows: TRawRow[]): AquiferLayerStatsDto[] {
    const total = rows.length;

    return AQUIFER_LAYERS.map((layer): AquiferLayerStatsDto => {
        const inLayer = rows.filter((r) => r.depth >= layer.min && r.depth < layer.max);
        const count = inLayer.length;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;

        const result: AquiferLayerStatsDto = {
            id: layer.id,
            label: layer.label,
            minDepth: layer.min,
            // Infinity → null в JSON чтобы фронт не получал {"max": null} строкой.
            maxDepth: Number.isFinite(layer.max) ? layer.max : null,
            count,
            pct,
            medianChemistry: {},
        };

        if (count === 0) return result;

        // Median depth в этом горизонте
        const sortedDepths = [...inLayer].map((r) => r.depth).sort((a, b) => a - b);
        result.medianDepth = roundTo(percentile(sortedDepths, 0.5), 1);

        // pctWell в этом горизонте
        const wellCount = inLayer.filter((r) => r.intake_type === 'well').length;
        result.pctWell = Math.round((wellCount / count) * 100);

        // Median chemistry — для каждого paramCode collect values + median
        const paramSamples = new Map<string, number[]>();
        for (const row of inLayer) {
            for (const [code, raw] of Object.entries(row.params)) {
                if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
                let bucket = paramSamples.get(code);
                if (!bucket) {
                    bucket = [];
                    paramSamples.set(code, bucket);
                }
                bucket.push(raw);
            }
        }

        for (const [code, values] of paramSamples) {
            // Skip params которые в этом layer measured только 1-2 раза — median
            // на 1-2 точках бессмысленна, шум. Минимум 3 значения для inclusion.
            if (values.length < 3) continue;
            const sorted = values.slice().sort((a, b) => a - b);
            result.medianChemistry[code] = roundTo(percentile(sorted, 0.5), 4);
        }

        return result;
    });
}

function computeDominantLayerId(layers: AquiferLayerStatsDto[]): string | null {
    if (layers.length === 0) return null;
    const total = layers.reduce((sum, l) => sum + l.count, 0);
    if (total === 0) return null;

    return layers.reduce((best, cur) => (cur.count > best.count ? cur : best)).id;
}

function buildCacheKey(
    intakeType: TDepthMapIntakeFilter,
    west: number,
    south: number,
    east: number,
    north: number,
): string {
    const r = (n: number): string => n.toFixed(4);
    return `aquifer-stats:${intakeType}:${r(west)}:${r(south)}:${r(east)}:${r(north)}`;
}
