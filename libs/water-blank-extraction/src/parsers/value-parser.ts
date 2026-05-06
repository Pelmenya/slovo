// Парсинг valueRaw из бланков водного анализа в нормализованную форму.
//
// Из dataset (238 498 значений на 15 504 бланка) выявлены 6 паттернов:
//   - "7,2" / "0,01"        — RU decimal (запятая)        — 72%
//   - "5" / "10"             — целое число                  — 21%
//   - "<0,01"                — ниже предела детектирования  — 4.6%
//   - ">10"                  — выше верхнего предела        — 0.06%
//   - "5-10"                 — диапазон (range)             — 0.004%
//   - "не обнаружено" / "н.о." / "отсут." — null + флаг     — единичные
//
// Стандарт аналитики для below-detection: value = limit/2 (половина порога).
// Для above-limit: value = limit (нижняя граница, без overshoot).
// Для range: value = (min + max) / 2 (median = average для двух точек).

export type TParseFlag =
    | 'below_detection'
    | 'above_limit'
    | 'range'
    | 'not_detected';

export type TParseResult = {
    value: number | null;
    flags: TParseFlag[];
    /** Для below_detection — отсечка детектора; для above_limit — нижняя граница. */
    detectionLimit?: number;
    /** Для range — границы исходного диапазона. */
    rangeMin?: number;
    rangeMax?: number;
};

const NOT_DETECTED_PATTERNS: RegExp[] = [
    /^не\s*обнаруж/i,
    /^н\.\s*о\.?$/i,
    /^нет$/i,
    /^отсут/i,
];

const RANGE_PATTERN = /^(\d+(?:[,.]\d+)?)\s*-\s*(\d+(?:[,.]\d+)?)$/;

/** Парсит RU-формат числа с запятой ("7,2") или с точкой ("7.2"). NaN → null. */
function parseNumber(raw: string): number | null {
    const cleaned = raw.trim().replace(',', '.');
    if (cleaned === '') return null;
    const num = Number.parseFloat(cleaned);
    return Number.isFinite(num) ? num : null;
}

/**
 * Парсит сырое значение параметра воды в число + флаги.
 *
 * @param raw — строка из vision_payload.params[].valueRaw
 * @returns value (число или null) + flags (массив маркеров особых случаев)
 */
export function parseValue(raw: string | null | undefined): TParseResult {
    if (raw === null || raw === undefined) {
        return { value: null, flags: [] };
    }
    const cleaned = raw.trim();
    if (cleaned === '') {
        return { value: null, flags: [] };
    }

    // Not detected: «не обнаружено», «н.о.», «нет», «отсут.»
    for (const re of NOT_DETECTED_PATTERNS) {
        if (re.test(cleaned)) {
            return { value: null, flags: ['not_detected'] };
        }
    }

    // Below detection: «<0,01» или «≤0.01»
    if (cleaned.startsWith('<') || cleaned.startsWith('≤')) {
        const limit = parseNumber(cleaned.slice(1));
        if (limit === null) return { value: null, flags: [] };
        return {
            value: limit / 2,
            flags: ['below_detection'],
            detectionLimit: limit,
        };
    }

    // Above limit: «>10» или «≥10»
    if (cleaned.startsWith('>') || cleaned.startsWith('≥')) {
        const limit = parseNumber(cleaned.slice(1));
        if (limit === null) return { value: null, flags: [] };
        return {
            value: limit,
            flags: ['above_limit'],
            detectionLimit: limit,
        };
    }

    // Range: «5-10» или «5,5-10,5» (важно — RANGE_PATTERN отбрасывает «5,5»
    // и «<0,01» так как в них нет ровно одного дефиса между числами)
    const rangeMatch = RANGE_PATTERN.exec(cleaned);
    if (rangeMatch) {
        const min = parseNumber(rangeMatch[1]);
        const max = parseNumber(rangeMatch[2]);
        if (min !== null && max !== null && max > min) {
            return {
                value: (min + max) / 2,
                flags: ['range'],
                rangeMin: min,
                rangeMax: max,
            };
        }
    }

    // Plain number — последний попытка
    const num = parseNumber(cleaned);
    return { value: num, flags: [] };
}
