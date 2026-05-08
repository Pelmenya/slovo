// =============================================================================
// Shared math utilities для water-analysis services.
//
// Вынесено из 7 endpoint-services после nestjs-code-reviewer findings (8 мая 2026):
// - `percentile()` дублировался ×3 (predict, depth-predict, aquifer-stats)
// - `roundTo()` дублировался ×4 (predict, depth-predict, depth-map, aquifer-stats)
// - `weightedMean()` ×2 (predict, depth-predict)
// - `medianOfDistances()` ×2 (predict, depth-predict)
// - `ageInYears()` ×2 (predict, depth-predict)
//
// Если потребуется wider scope (libs/common или libs/water-blank-extraction) —
// extract далее. Сейчас scope = water-analysis модуль.
// =============================================================================

/**
 * Linear-interpolation percentile из sorted array. p ∈ [0, 1].
 * Возвращает NaN на пустом массиве (caller filtrует).
 */
export function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return Number.NaN;
    if (sorted.length === 1) return sorted[0];
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
}

/**
 * Round до digits знаков. NaN/Infinity → 0 (defensive — Prisma/jsonb может
 * вернуть едкие значения, JSON.stringify(NaN)=null ломает контракт).
 */
export function roundTo(value: number, digits: number): number {
    if (!Number.isFinite(value)) return 0;
    const factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
}

/**
 * Weighted arithmetic mean. NaN если все weights нулевые (caller проверяет).
 */
export function weightedMean(values: number[], weights: number[]): number {
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
 * Возраст в годах между двумя датами (today.getTime() − sample.getTime()).
 * Используется для recency-weighting в kNN: weight ∝ exp(-age / HALF_LIFE).
 */
export function ageInYears(today: Date, sampleDate: Date): number {
    const ms = today.getTime() - sampleDate.getTime();
    return ms / (1000 * 60 * 60 * 24 * 365.25);
}

/**
 * Медиана расстояний (км) для UI «medianDistKm». Возвращает 0 на пустом массиве
 * (для UI «нет данных» — отдельный insufficientData флаг).
 */
export function medianOfDistances(distances: readonly number[]): number {
    if (distances.length === 0) return 0;
    const sorted = [...distances].sort((a, b) => a - b);
    return percentile(sorted, 0.5);
}
