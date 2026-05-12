// deriveIntakeType — алгоритмический вывод типа источника воды из извлечённых
// текстовых полей бланка. Используется Docling-путём.
//
// Почему функция нужна:
//   Vision-Haiku видит state checkbox'а в row 3 (☑/☐) и возвращает корректный
//   `intakeType` ('скважина'/'колодец'/'родник'/'водопровод'). Docling видит
//   только text-layer — там labels ВСЕХ четырёх checkbox'ов присутствуют
//   одинаково, без отметки. Поэтому Docling-путь не извлекает intakeType
//   напрямую (см. Discovery #4 в docs/experiments/water-analysis/2026-05-12-docling-migration.md)
//   и деривирует его эвристически.
//
// Стратегия по скоупам данных:
//   - **Existing 15504** (Vision уже отработал в апреле 2026): intakeType
//     берётся напрямую из `WaterAnalysisRaw.visionPayload.intakeType` —
//     ground truth, видел checkbox. Эту функцию для них НЕ вызывать.
//   - **Новые бланки** (Docling-only, без Vision): эта функция — единственный
//     способ. Accuracy ~85-90% на bench-validation против Vision-labels
//     (Slice 1.5, отдельный tuning-скрипт в experiments/).
//   - **Edge cases в новых бланках** (нет depth + нет hint): default
//     `municipal`. Если 99%+ accuracy критична — опционально Vision-fallback
//     на ~10% таких бланков (~$0.0003 × ~10% × N).
//
// «Глубины может не быть» — норма; функция падает в hint-match или в default
// municipal. Это сознательный trade-off: false municipal лучше чем выбрасывать
// бланк, downstream сможет переоценить через chemistry-pattern если нужно.
//
// Алгоритм:
//   1. Hint-based: ищем характерные слова в `samplingPoint` + `customerNotes`
//      (рукописные приписки в Row 3 cell5/cell6 + клиентские заметки +
//      опц. filename-hint через тот же slot — function regex-матчит keywords
//      независимо от источника).
//      Срабатывает первое совпадение (приоритет: родник > река > скважина > колодец > водопровод).
//   2. Depth-based fallback: если hint'а нет, но известна `depthMeters` —
//      threshold **15 м** (глубже = скважина, иначе колодец).
//   3. Default: `municipal` (центральный/местный водопровод).
//
// **Tuned on 15504 Vision-labels (Slice 1.5, 2026-05-12)** — Strategy C
// accuracy 73.34%:
//   - Threshold=15м оптимален в sweep 15/20/25/30 (best balance).
//   - Strategy C (hint + depth=15) — лучший balanced профиль:
//     well_R=0.68, well_dug_R=0.65, municipal_R=0.95, spring_R=0.41.
//   - Target ≥95% недостижим без extraction рукописных samplingPoint из
//     Docling (Slice 3 потенциал) или Vision-fallback на ~10% no-depth+no-hint.
// Полные runs см. `experiments/.../data/intake-tuning/run-*.json`.

export type TWaterSourceType = 'well' | 'well_dug' | 'municipal' | 'spring' | 'river' | 'other';

/**
 * Источник определения intakeType — для observability в downstream
 * («откуда мы знаем что этот бланк — well_dug?»). В Slice 3 ETL будет
 * писаться в колонку `WaterAnalysis.intake_source` рядом с
 * `extraction_engine`. Используется через `deriveIntakeTypeWithSource()`.
 */
export type TIntakeSource =
    | 'hint_spring'        // matched hint regex → spring
    | 'hint_river'         // matched hint regex → river
    | 'hint_well'          // matched hint regex → well (скважина / арт.скв)
    | 'hint_well_dug'      // matched hint regex → well_dug (колодец)
    | 'hint_municipal'    // matched hint regex → municipal (водопровод)
    | 'depth_well'         // depth > threshold → well
    | 'depth_well_dug'     // depth ≤ threshold → well_dug
    | 'default_municipal'; // no depth + no hint → default

// Tuned on 15504 Vision-labels, 2026-05-12 (Slice 1.5):
// 15 — peak accuracy в sweep [15, 20, 25, 30, 35], lift +5pp над 25м.
// Reason: well-distribution P10=17, P50=47 — много скважин 15-25м,
// threshold=25 их режет в well_dug.
const WELL_DEPTH_THRESHOLD_METERS = 15;

// Hint-patterns в порядке приоритета. Срабатывает первый match.
// Точный порядок: spring → river → well → well_dug → municipal.
// Reason: «скважина» иногда упоминается в контексте колодца («колодец рядом со скважиной»),
// поэтому проверяем колодец после скважины и принимаем риск false-well. Но «родник» / «река»
// уникальные, их можно проверять первыми.
//
// NB: `\b` в JS работает только для ASCII word chars — для Cyrillic используем
// явный lookahead/lookbehind с Cyrillic char class `[а-яё]`.
const HINT_PATTERNS: Array<{ regex: RegExp; type: TWaterSourceType }> = [
    // «ключ» с допустимыми окончаниями (ключ, ключи, из ключа, ключевая):
    // (?<![а-яё])ключ[аеиую]?(?![а-яё]) — позволяет суффикс до 1 буквы, не ловит
    // «ключевой» / «ключик» (там 2+ суффикса) и не ломает «ракушки».
    { regex: /родник|(?<![а-яё])ключ[аеиую]?(?![а-яё])|источник/i, type: 'spring' },
    { regex: /(?<![а-яё])рек[аеуо](?![а-яё])|речк|водоём|водоем|озер|пруд/i, type: 'river' },
    { regex: /скважин|арт\.?\s*сква|артскваж/i, type: 'well' },
    { regex: /колод[еяцч]/i, type: 'well_dug' },
    { regex: /водопровод|центр\.?\s*вод|из\s+крана|кран\s+на\s+кух/i, type: 'municipal' },
];

// Маппинг type → source для hint-matched results.
const TYPE_TO_HINT_SOURCE: Record<TWaterSourceType, TIntakeSource> = {
    spring: 'hint_spring',
    river: 'hint_river',
    well: 'hint_well',
    well_dug: 'hint_well_dug',
    municipal: 'hint_municipal',
    other: 'default_municipal', // never produced by hint regex
};

/**
 * Деривирует тип источника воды из текстовых полей бланка.
 *
 * `samplingPoint` slot предназначен для **любых hint-источников** —
 * рукописная приписка из бланка, filename-hint (sourceTypeHint /
 * customerNameFromFilename), пользовательская заметка. Function regex-матчит
 * keywords независимо от происхождения.
 *
 * @param depthMeters — глубина скважины/колодца в метрах (или null)
 * @param samplingPoint — hint-text (рукописная приписка / filename-hint / etc.)
 * @param customerNotes — заметки клиента (или null) — конкатенируется с samplingPoint
 * @returns enum-значение `TWaterSourceType` (никогда не null — default `municipal`).
 */
export function deriveIntakeType(
    depthMeters: number | null | undefined,
    samplingPoint: string | null | undefined,
    customerNotes: string | null | undefined,
): TWaterSourceType {
    return deriveIntakeTypeWithSource(depthMeters, samplingPoint, customerNotes).type;
}

/**
 * Variant с дополнительным tracking источника решения. Используется когда
 * downstream должен записать `intake_source` для аудита («почему этот бланк
 * классифицирован как well_dug?»).
 *
 * Slice 3 ETL: `result.intakeSource = visionPayload?.intakeType
 *               ? 'vision'                          // checkbox-truth
 *               : deriveIntakeTypeWithSource(...).source`
 *
 * @returns `{ type, source }` — type как у `deriveIntakeType`,
 *   source указывает на сработавшую ветку алгоритма.
 */
export function deriveIntakeTypeWithSource(
    depthMeters: number | null | undefined,
    samplingPoint: string | null | undefined,
    customerNotes: string | null | undefined,
): { type: TWaterSourceType; source: TIntakeSource } {
    const hint = `${samplingPoint ?? ''} ${customerNotes ?? ''}`.trim();

    if (hint !== '') {
        for (const { regex, type } of HINT_PATTERNS) {
            if (regex.test(hint)) {
                return { type, source: TYPE_TO_HINT_SOURCE[type] };
            }
        }
    }

    if (depthMeters !== null && depthMeters !== undefined && depthMeters > 0) {
        if (depthMeters > WELL_DEPTH_THRESHOLD_METERS) {
            return { type: 'well', source: 'depth_well' };
        }
        return { type: 'well_dug', source: 'depth_well_dug' };
    }

    return { type: 'municipal', source: 'default_municipal' };
}
