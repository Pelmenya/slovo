// Главная функция нормализации параметров водного анализа.
//
// Берёт сырые params из vision_payload (массив объектов с name/valueRaw/unitRaw)
// и возвращает структурированные данные для записи в WaterAnalysis:
//   - params:           Record<paramCode, value>     — основной denorm payload
//   - paramUnits:       Record<paramCode, string>    — каноническая единица
//   - paramFlags:       Record<paramCode, flags[]>   — особые случаи
//   - paramsUnknown:    Record<rawName, raw>         — Vision-галлюцинации для review
//
// Маппинг raw.name → paramCode через PARAM_SYNONYMS из справочника СанПиН.
// Парсинг valueRaw через parseValue(). Unit-валидация через normalizeUnit().
//
// Vision OCR-confusions (находки 2026-05-06 после ручной сверки 100 бланков
// + независимого аудита агентом):
//   1. Магний (Mg²⁺) ↔ Марганец (Mn): 70% бланков (10 779/15 504) — позиционная disambiguation.
//   2. Сульфиды (S²⁻) ↔ Сульфаты (SO₄²⁻): 12% бланков (1 870) — disambiguation по value.
//   3. Жёсткость общая ↔ Электропроводность / Окисляемость перманганатная: ~единицы / 116 бланков
//      — disambiguation по unit (мг-экв/л однозначно жёсткость).
// Все три pattern'а исправляются БЕЗ re-extraction, по корректным значениям и позициям.

import { PARAM_SYNONYMS } from '../sanpin/sanpin-1-2-3685-21-v1.0.0';
import { parseValue, type TParseFlag, type TParseResult } from '../parsers/value-parser';
import { normalizeUnit } from '../parsers/unit-converter';

export type TRawParam = {
    name?: string | null;
    valueRaw?: string | null;
    unitRaw?: string | null;
};

export type TParamFlag = TParseFlag | 'unit_mismatch' | 'parse_failed' | 'duplicate';

export type TUnknownParam = {
    valueRaw: string | null;
    unitRaw: string | null;
    reason: 'no_synonym' | 'parse_failed';
};

export type TNormalizationResult = {
    /** paramCode → числовое значение (после parseValue + below_detection / range adjustments). */
    params: Record<string, number>;

    /** paramCode → каноническая единица измерения. Не пишется если unit_mismatch (сырое значение оставляем только в paramFlags). */
    paramUnits: Record<string, string>;

    /** paramCode → массив флагов особых случаев. Отсутствие ключа = no flags. */
    paramFlags: Record<string, TParamFlag[]>;

    /** Амбивалентные / OCR-галлюцинации (например, «Кислотность общая») для review. */
    paramsUnknown: Record<string, TUnknownParam>;
};

const HARDNESS_UNITS = new Set(['мг-экв/л', 'мгэкв/л', 'ммоль/л']);

/**
 * Sulfides ↔ Sulfates Vision confusion. Реальные сульфаты в питьевой воде — 10-500 mg/l,
 * сульфиды — единицы µg/l - mg/l (значимо ниже 1). Граница 1 mg/l надёжно их разделяет.
 */
function reclassifySulfatesToSulfides(parsedValue: number | null): 'sulfides' | null {
    if (parsedValue === null) return null;
    if (parsedValue < 1) return 'sulfides';
    return null;
}

/**
 * Жёсткость в мг-экв/л случается под именами electrical_conductivity и
 * permanganate_oxidizability (Vision переименовывает / галлюцинирует имя строки,
 * но единица остаётся правильной — мг-экв/л однозначно указывает на жёсткость).
 */
function reclassifyToHardnessByUnit(raw: TRawParam): 'hardness_total' | null {
    const unit = (raw.unitRaw ?? '').toLowerCase().trim().replace(/\u00A0/g, ' ');
    if (HARDNESS_UNITS.has(unit)) {
        return 'hardness_total';
    }
    return null;
}

type TPreParsed = {
    raw: TRawParam;
    cleanName: string;
    paramCode: string | undefined;
    parsed: TParseResult;
    ord: number;
};

/**
 * Позиционная Mg/Mn disambiguation. В бланках Аквафор магний и марганец идут
 * соседними строками (магний → марганец). Vision часто выдаёт обе как «Марганец»,
 * но порядок ord сохраняется — поэтому первая запись `manganese` → magnesium,
 * вторая → manganese.
 *
 * Условие: 2+ записей с paramCode=manganese в одном бланке. Если одиночная —
 * fallback по value (>10 mg/l → magnesium, иначе manganese).
 */
function applyManganeseDisambiguation(items: TPreParsed[]): void {
    const manganeseItems = items.filter((i) => i.paramCode === 'manganese');

    if (manganeseItems.length >= 2) {
        // Position-based: первый по ord = magnesium, остальные = manganese
        manganeseItems.sort((a, b) => a.ord - b.ord);
        manganeseItems[0].paramCode = 'magnesium';
        return;
    }

    if (manganeseItems.length === 1) {
        // Fallback: одиночное значение > 10 mg/l = магний (Mn так высоко не бывает)
        const item = manganeseItems[0];
        const value = item.parsed.value;
        if (value !== null && value > 10) {
            item.paramCode = 'magnesium';
        }
    }
}

export function normalizeWaterParams(rawParams: TRawParam[]): TNormalizationResult {
    const params: Record<string, number> = {};
    const paramUnits: Record<string, string> = {};
    const paramFlags: Record<string, TParamFlag[]> = {};
    const paramsUnknown: Record<string, TUnknownParam> = {};

    // Pass 1: pre-parse, lookup synonyms, reclassify по unit (но НЕ ещё по value/позиции).
    const items: TPreParsed[] = [];
    for (let i = 0; i < rawParams.length; i++) {
        const raw = rawParams[i];
        if (!raw.name) continue;
        const cleanName = raw.name.trim();
        if (cleanName === '') continue;

        const parsed = parseValue(raw.valueRaw);
        let paramCode = PARAM_SYNONYMS[cleanName.toLowerCase()];

        // Hardness reclass работает на specific OCR-confused paramCode'ах.
        // Ловит: electrical_conductivity, permanganate_oxidizability — оба наблюдались
        // в dataset как Vision-галлюцинации имени поверх строки «Жёсткость общая».
        // НЕ применяется для unknown (paramCode=undefined): «Кислотность общая мг-экв/л»
        // — это реальный отдельный параметр, не жёсткость.
        if (paramCode === 'electrical_conductivity' || paramCode === 'permanganate_oxidizability') {
            const reclassified = reclassifyToHardnessByUnit(raw);
            if (reclassified) {
                paramCode = reclassified;
            }
        }

        // Sulfides reclass: маленькое value под именем sulfates → sulfides.
        if (paramCode === 'sulfates') {
            const reclassified = reclassifySulfatesToSulfides(parsed.value);
            if (reclassified) {
                paramCode = reclassified;
            }
        }

        items.push({ raw, cleanName, paramCode, parsed, ord: i });
    }

    // Pass 2: позиционная Mg/Mn disambiguation требует видеть весь массив.
    applyManganeseDisambiguation(items);

    // Pass 3: запись результата.
    for (const item of items) {
        const { raw, cleanName, paramCode, parsed } = item;

        if (!paramCode) {
            paramsUnknown[cleanName] = {
                valueRaw: raw.valueRaw ?? null,
                unitRaw: raw.unitRaw ?? null,
                reason: 'no_synonym',
            };
            continue;
        }

        // Дубль — параметр уже зафиксирован в этом бланке
        if (params[paramCode] !== undefined) {
            const existing = paramFlags[paramCode] ?? [];
            if (!existing.includes('duplicate')) {
                paramFlags[paramCode] = [...existing, 'duplicate'];
            }
            continue;
        }

        const flags: TParamFlag[] = [...parsed.flags];

        // not_detected: записываем флаг без значения
        if (flags.includes('not_detected')) {
            paramFlags[paramCode] = flags;
            continue;
        }

        // Парсинг не дал числа и нет особых флагов → запись в unknown
        if (parsed.value === null) {
            paramsUnknown[cleanName] = {
                valueRaw: raw.valueRaw ?? null,
                unitRaw: raw.unitRaw ?? null,
                reason: 'parse_failed',
            };
            continue;
        }

        // Unit normalization. При unit_mismatch НЕ пишем в paramUnits — downstream
        // должен видеть только канонические единицы (избегаем микса canonical+raw).
        // Сырое значение легко достать из water_analysis_raw.vision_payload по paramCode.
        const canonicalUnit = normalizeUnit(paramCode, raw.unitRaw);
        const unitProvided = raw.unitRaw !== null && raw.unitRaw !== undefined && raw.unitRaw.trim() !== '';
        if (canonicalUnit !== null) {
            paramUnits[paramCode] = canonicalUnit;
        } else if (unitProvided) {
            flags.push('unit_mismatch');
        }

        params[paramCode] = parsed.value;
        if (flags.length > 0) {
            paramFlags[paramCode] = flags;
        }
    }

    return { params, paramUnits, paramFlags, paramsUnknown };
}
