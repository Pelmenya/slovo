import { AQUIFER_LAYERS } from '../water-analysis.constants';
import { percentile } from './math';

// =============================================================================
// Shared aquifer-layer logic. Дублировалось ×2 (predict.service +
// depth-predict.service) для определения most-likely водоносного горизонта
// по медиане глубин соседей.
// =============================================================================

/** Минимальное число соседей с известной depth для определения most-likely
 *  aquifer layer. <3 → undefined (мало данных, не показываем чтобы не вводить
 *  в заблуждение). */
export const AQUIFER_MIN_NEIGHBORS = 3;

/**
 * Most-likely aquifer layer по медиане глубин соседей. Возвращает label
 * («50-100m / Песчано-известняковый») или undefined если данных <3.
 *
 * Caller передаёт уже фильтрованных neighbors (только wells/well_dug с
 * известной depth). Проверка intake_type делается на caller-side, эта функция
 * принимает массив depths (number) уже подготовленный.
 */
export function computeMostLikelyAquiferLayer(depths: readonly number[]): string | undefined {
    if (depths.length < AQUIFER_MIN_NEIGHBORS) return undefined;
    const sorted = [...depths].sort((a, b) => a - b);
    const median = percentile(sorted, 0.5);
    const layer = AQUIFER_LAYERS.find((l) => median >= l.min && median < l.max);
    return layer?.label;
}
