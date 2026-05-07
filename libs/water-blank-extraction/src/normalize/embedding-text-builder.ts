// Генератор текстового описания водного анализа для embedding-модели.
//
// Принцип: детерминированная функция (input → output без LLM-вызовов).
// Входные данные derived `WaterAnalysis` структура → natural language Russian.
//
// Что включаем:
//   - Тип источника (скважина / колодец / водопровод / родник / открытый водоём)
//   - Глубина (для скважин/колодцев)
//   - Все измеренные параметры со значениями + ед.изм.
//   - Превышения ПДК помечены явно ("превышение")
//   - Внешний вид (appearance — мутная / прозрачная / мутнеет со временем)
//
// Что НЕ включаем (zone отдельных axis):
//   - lat/lon, region/locality — гео-axis отдельно (PostGIS ST_DWithin)
//   - labName — лаборатория не должна влиять на семантику воды
//   - sample_date — временной axis отдельно при необходимости
//   - PII — отсутствует в derived (Variant A)
//
// Порядок параметров:
//   1. Сначала превышения ПДК (важные сигналы для подбора оборудования)
//   2. Потом остальные параметры в стабильном порядке (для воспроизводимости)

import { exceedsPdk, getParamUnit, WATER_PARAMS_BY_CODE } from '../sanpin/sanpin-1-2-3685-21-v1.0.0';

export type TWaterAnalysisRecord = {
    intakeType: 'well' | 'well_dug' | 'municipal' | 'spring' | 'river' | 'other';
    depthMeters: number | null;
    appearance: string | null;
    params: Record<string, number>;
    paramUnits: Record<string, string>;
    paramFlags: Record<string, string[]>;
};

const INTAKE_TYPE_RU: Record<TWaterAnalysisRecord['intakeType'], string> = {
    well: 'Скважина',
    well_dug: 'Колодец',
    municipal: 'Центральный водопровод',
    spring: 'Родник',
    river: 'Открытый водоём',
    other: 'Источник воды',
};

/**
 * Стабильный порядок параметров для воспроизводимости текста и embedding'а.
 * Внутри секций — логическая группировка по типу анализа.
 */
const PARAM_ORDER: string[] = [
    // Органолептика
    'temperature', 'odor', 'ph', 'color', 'turbidity',
    // Общие
    'tds', 'electrical_conductivity', 'hardness_total', 'alkalinity_total', 'permanganate_oxidizability',
    // Металлы
    'iron_total', 'iron_2plus', 'manganese', 'magnesium', 'calcium',
    // Анионы
    'nitrates', 'nitrites', 'sulfates', 'sulfides', 'chlorides', 'fluorides',
    // Прочее
    'ammonium', 'hydrogen_sulfide',
];

/**
 * Округляет число до значащих цифр для compact-представления.
 * 0.0001 → "0.0001", 0.5 → "0.5", 5.234 → "5.23", 1234 → "1234".
 */
function formatValue(value: number): string {
    if (value === 0) return '0';
    const abs = Math.abs(value);
    if (abs >= 100) return value.toFixed(0);
    if (abs >= 10) return value.toFixed(1).replace(/\.0$/, '');
    if (abs >= 1) return value.toFixed(2).replace(/\.?0+$/, '');
    if (abs >= 0.01) return value.toFixed(3).replace(/\.?0+$/, '');
    return value.toFixed(4).replace(/\.?0+$/, '');
}

/**
 * Описывает один параметр как фразу: "железо 1.5 мг/л (превышение)"
 */
function buildParamPhrase(
    paramCode: string,
    value: number,
    paramUnits: Record<string, string>,
    paramFlags: Record<string, string[]>,
): string | null {
    const param = WATER_PARAMS_BY_CODE[paramCode];
    if (!param) return null;

    const unit = getParamUnit(paramCode, paramUnits) ?? '';
    const formatted = formatValue(value);
    const flags = paramFlags[paramCode] ?? [];

    let phrase = `${param.nameRu.toLowerCase()} ${formatted}`;
    if (unit) phrase += ` ${unit}`;

    const annotations: string[] = [];

    // Превышение ПДК — главный сигнал для подбора оборудования
    if (exceedsPdk(paramCode, value) === true) {
        annotations.push('превышение');
    }

    // Below detection — значение значимо ниже определяемой границы
    if (flags.includes('below_detection')) {
        annotations.push('ниже предела детектирования');
    }

    if (annotations.length > 0) {
        phrase += ` (${annotations.join(', ')})`;
    }

    return phrase;
}

/**
 * Генерирует текстовое описание для embedding-модели.
 *
 * @param record — derived WaterAnalysis (params, paramUnits, paramFlags, intake_type, depth, appearance)
 * @returns natural language Russian, ~50-150 токенов
 */
export function generateEmbeddingText(record: TWaterAnalysisRecord): string {
    const parts: string[] = [];

    // Header: тип источника + глубина
    let header = INTAKE_TYPE_RU[record.intakeType] ?? 'Источник воды';
    if (record.depthMeters !== null && record.depthMeters > 0) {
        header += ` ${formatValue(record.depthMeters)} м`;
    }
    parts.push(header + '.');

    // Параметры — сначала превышения, потом нормальные
    const exceeded: string[] = [];
    const normal: string[] = [];

    for (const code of PARAM_ORDER) {
        const value = record.params[code];
        if (value === undefined) continue;
        const phrase = buildParamPhrase(code, value, record.paramUnits, record.paramFlags);
        if (!phrase) continue;
        if (exceedsPdk(code, value) === true) {
            exceeded.push(phrase);
        } else {
            normal.push(phrase);
        }
    }

    if (exceeded.length > 0) {
        parts.push('Превышения ПДК: ' + exceeded.join(', ') + '.');
    }
    if (normal.length > 0) {
        parts.push('Прочие параметры: ' + normal.join(', ') + '.');
    }

    // Внешний вид (если есть)
    if (record.appearance && record.appearance.trim() !== '') {
        parts.push(`Внешний вид: ${record.appearance}.`);
    }

    return parts.join(' ');
}
