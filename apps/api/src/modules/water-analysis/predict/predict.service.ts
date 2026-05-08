import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@slovo/database';
import { exceedsPdk } from '@slovo/water-blank-extraction';
import type Redis from 'ioredis';
import {
    AQUIFER_LAYERS,
    PREDICT_CACHE_TTL_SECONDS,
    PREDICT_DEFAULT_K,
    PREDICT_DEFAULT_RADIUS_KM,
    PREDICT_IDW_SCALE_KM,
    PREDICT_RECENCY_HALF_LIFE_YEARS,
    PREDICT_REDIS_TOKEN,
} from '../water-analysis.constants';
import type { PredictQueryDto } from './dto/predict.request.dto';
import type {
    PredictParamEstimateDto,
    PredictResponseDto,
} from './dto/predict.response.dto';

// =============================================================================
// PredictService — kNN-прогноз химии воды для нового адреса (USP-1).
//
// Pipeline:
//   1. Cache lookup по rounded coords (3 знака ≈ 100м, чтобы похожие точки
//      попадали в один cache key).
//   2. SQL: top-K ближайших анализов в радиусе (ST_DWithin + GIST индекс).
//      Возвращает params jsonb + depth_meters + sample_date + dist_km.
//   3. TS aggregation: для каждого paramCode (22 canonical) — extract numeric
//      values из jsonb, compute distance+recency weighted average + P10/P90
//      percentile interval из той же выборки.
//   4. Bonus drilling: если ≥3 соседей-wells/well_dug имели depth — определяем
//      mostLikelyAquiferLayer по медиане их глубин.
//   5. Cache set с TTL 5 мин.
//
// Math:
//   weight_i = (1 / (1 + dist_i / IDW_SCALE)) * exp(-age_i / HALF_LIFE)
//   value = sum(v_i * w_i) / sum(w_i)
//   ciLow = P10(values), ciHigh = P90(values)  // unweighted percentile
//
// Решение по percentile (unweighted) — взяли простой и интерпретируемый
// «80% соседей в [P10, P90]». Можно улучшить через bootstrap (weighted resampling)
// если выяснится что P10/P90 mismatched со средним. Сейчас MVP.
// =============================================================================

@Injectable()
export class PredictService {
    private readonly logger = new Logger(PredictService.name);

    constructor(
        private readonly prisma: PrismaService,
        @Inject(PREDICT_REDIS_TOKEN) private readonly redis: Redis,
    ) {}

    async predict(dto: PredictQueryDto): Promise<PredictResponseDto> {
        const k = dto.k ?? PREDICT_DEFAULT_K;
        const radiusKm = dto.radiusKm ?? PREDICT_DEFAULT_RADIUS_KM;
        const cacheKey = buildCacheKey(dto.lat, dto.lon, k, radiusKm);

        const cached = await this.tryCacheGet(cacheKey);
        if (cached) {
            return { ...cached, cached: true };
        }

        const t0 = Date.now();
        const rows = await this.fetchNeighbors(dto.lat, dto.lon, radiusKm, k);
        const timeTakenMs = Date.now() - t0;

        const today = new Date();
        const aggregated = aggregateNeighbors(rows, today);
        const predicted = buildPredictedRecord(aggregated);
        const aquiferLayer = computeMostLikelyAquiferLayer(rows);

        const response: PredictResponseDto = {
            predicted,
            nNeighbors: rows.length,
            medianDistKm: roundTo(medianOfDistances(rows), 2),
            radiusKm,
            insufficientData: rows.length === 0,
            timeTakenMs,
            cached: false,
        };
        if (aquiferLayer) {
            response.mostLikelyAquiferLayer = aquiferLayer;
        }

        this.tryCacheSet(cacheKey, response).catch(() => {
            /* swallowed */
        });

        return response;
    }

    private async fetchNeighbors(
        lat: number,
        lon: number,
        radiusKm: number,
        k: number,
    ): Promise<TNeighborRow[]> {
        // ST_DWithin на geography — точное расстояние в метрах. Использует GIST
        // индекс на geo_point. ORDER BY дистанции + LIMIT k для kNN. Извлекаем
        // params целиком (jsonb до 22 параметров на анализ — небольшой payload),
        // depth_meters, intake_type, sample_date — для downstream агрегаций.
        return this.prisma.$queryRaw<TNeighborRow[]>`
            SELECT
                params,
                depth_meters,
                intake_type::text AS intake_type,
                sample_date,
                ST_Distance(
                    geo_point,
                    ST_SetSRID(ST_MakePoint(${lon}::float8, ${lat}::float8), 4326)::geography
                )::float8 / 1000.0 AS dist_km
            FROM water_analysis
            WHERE
                geo_point IS NOT NULL
                AND ST_DWithin(
                    geo_point,
                    ST_SetSRID(ST_MakePoint(${lon}::float8, ${lat}::float8), 4326)::geography,
                    ${radiusKm}::float8 * 1000.0
                )
            ORDER BY dist_km ASC
            LIMIT ${k}
        `;
    }

    private async tryCacheGet(key: string): Promise<PredictResponseDto | null> {
        try {
            const raw = await this.redis.get(key);
            if (!raw) return null;
            return JSON.parse(raw) as PredictResponseDto;
        } catch (err) {
            this.logger.warn(`predict cache GET failed: ${stringifyError(err)} (key=${key})`);
            return null;
        }
    }

    private async tryCacheSet(key: string, value: PredictResponseDto): Promise<void> {
        try {
            await this.redis.set(key, JSON.stringify(value), 'EX', PREDICT_CACHE_TTL_SECONDS);
        } catch (err) {
            this.logger.warn(`predict cache SET failed: ${stringifyError(err)} (key=${key})`);
        }
    }
}

// =============================================================================
// Types
// =============================================================================

type TNeighborRow = {
    params: Record<string, unknown>; // jsonb из БД, ключи — paramCode, значения — number обычно
    depth_meters: number | null;
    intake_type: string;
    sample_date: Date;
    dist_km: number;
};

type TParamSamples = {
    /** Сырые значения от каждого соседа имеющего этот param (без weights). */
    values: number[];
    /** Веса этих значений (distance × recency). Параллелен `values`. */
    weights: number[];
};

// =============================================================================
// Aggregation: per-param distance+recency-weighted average + percentile interval
// =============================================================================

function aggregateNeighbors(rows: TNeighborRow[], today: Date): Map<string, TParamSamples> {
    const buckets = new Map<string, TParamSamples>();

    for (const row of rows) {
        const distWeight = 1 / (1 + row.dist_km / PREDICT_IDW_SCALE_KM);
        const ageYears = ageInYears(today, row.sample_date);
        const recencyWeight = Math.exp(-ageYears / PREDICT_RECENCY_HALF_LIFE_YEARS);
        const weight = distWeight * recencyWeight;

        for (const [paramCode, raw] of Object.entries(row.params)) {
            if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;

            let bucket = buckets.get(paramCode);
            if (!bucket) {
                bucket = { values: [], weights: [] };
                buckets.set(paramCode, bucket);
            }
            bucket.values.push(raw);
            bucket.weights.push(weight);
        }
    }

    return buckets;
}

function buildPredictedRecord(
    buckets: Map<string, TParamSamples>,
): Record<string, PredictParamEstimateDto> {
    const result: Record<string, PredictParamEstimateDto> = {};

    for (const [paramCode, samples] of buckets) {
        if (samples.values.length === 0) continue;

        const value = weightedMean(samples.values, samples.weights);
        const sorted = [...samples.values].sort((a, b) => a - b);
        const ciLow = percentile(sorted, 0.1);
        const ciHigh = percentile(sorted, 0.9);
        const exceeds = exceedsPdk(paramCode, value);

        result[paramCode] = {
            value: roundTo(value, 4),
            ciLow: roundTo(ciLow, 4),
            ciHigh: roundTo(ciHigh, 4),
            n: samples.values.length,
            exceedsPdk: exceeds,
        };
    }

    return result;
}

// =============================================================================
// Drilling bonus: most-likely aquifer layer
// =============================================================================

// Минимальное число соседей-скважин с известной глубиной для определения
// mostLikelyAquiferLayer. <3 → undefined (мало данных, не показываем чтобы не
// дезинформировать клиента). AQUIFER_LAYERS — shared в `water-analysis.constants.ts`.
const AQUIFER_MIN_NEIGHBORS = 3;

function computeMostLikelyAquiferLayer(rows: TNeighborRow[]): string | undefined {
    const depths = rows
        .filter(
            (r) =>
                (r.intake_type === 'well' || r.intake_type === 'well_dug') &&
                typeof r.depth_meters === 'number' &&
                Number.isFinite(r.depth_meters),
        )
        .map((r) => r.depth_meters as number);

    if (depths.length < AQUIFER_MIN_NEIGHBORS) return undefined;

    const sorted = [...depths].sort((a, b) => a - b);
    const median = percentile(sorted, 0.5);
    const layer = AQUIFER_LAYERS.find((l) => median >= l.min && median < l.max);
    return layer?.label;
}

// =============================================================================
// Math helpers
// =============================================================================

function weightedMean(values: number[], weights: number[]): number {
    let sumWv = 0;
    let sumW = 0;
    for (let i = 0; i < values.length; i++) {
        sumWv += values[i] * weights[i];
        sumW += weights[i];
    }
    if (sumW === 0) return Number.NaN;
    return sumWv / sumW;
}

/**
 * Linear-interpolation percentile из sorted array. p ∈ [0, 1].
 * Возвращает NaN на пустом массиве (caller filtrует).
 */
function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return Number.NaN;
    if (sorted.length === 1) return sorted[0];
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
}

function medianOfDistances(rows: TNeighborRow[]): number {
    if (rows.length === 0) return 0;
    const sorted = rows.map((r) => r.dist_km).sort((a, b) => a - b);
    return percentile(sorted, 0.5);
}

function ageInYears(today: Date, sampleDate: Date): number {
    const ms = today.getTime() - sampleDate.getTime();
    return ms / (1000 * 60 * 60 * 24 * 365.25);
}

function roundTo(value: number, digits: number): number {
    if (!Number.isFinite(value)) return 0;
    const factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
}

// Cache key округление координат до 0.001° (~111м lat / ~64м lon на 55°).
// Точные координаты не имеют смысла кешировать (caller вряд ли пошлёт ту же
// 7-значную координату), а с округлением соседние точки попадают в один key.
function buildCacheKey(lat: number, lon: number, k: number, radiusKm: number): string {
    const r = (n: number): string => n.toFixed(3);
    return `predict:${r(lat)}:${r(lon)}:${k}:${r(radiusKm)}`;
}

function stringifyError(err: unknown): string {
    if (err instanceof Error) return err.message;
    return typeof err === 'string' ? err : JSON.stringify(err);
}
