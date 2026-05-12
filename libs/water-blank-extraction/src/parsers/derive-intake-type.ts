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
//      (рукописные приписки в Row 3 cell5/cell6 + клиентские заметки).
//      Срабатывает первое совпадение (приоритет: родник > река > скважина > колодец > водопровод).
//   2. Depth-based fallback: если hint'а нет, но известна `depthMeters` —
//      threshold 25 м (глубже = скважина, иначе колодец).
//   3. Default: `municipal` (центральный/местный водопровод).
//
// Ожидаемая accuracy ~85-90% на bench-validation против Vision-labels (см.
// docs Slice 1.5 — отдельный tuning-скрипт в experiments/). После tune
// thresholds + regex patterns подкручиваются здесь с пометкой `// Tuned on
// N blanks, YYYY-MM-DD, X% accuracy`.

export type TWaterSourceType = 'well' | 'well_dug' | 'municipal' | 'spring' | 'river' | 'other';

const WELL_DEPTH_THRESHOLD_METERS = 25;

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

/**
 * Деривирует тип источника воды из текстовых полей бланка.
 *
 * @param depthMeters — глубина скважины/колодца в метрах (или null)
 * @param samplingPoint — рукописная приписка точки отбора (или null)
 * @param customerNotes — заметки клиента (или null)
 * @returns enum-значение `TWaterSourceType` (никогда не null — default `municipal`).
 */
export function deriveIntakeType(
    depthMeters: number | null | undefined,
    samplingPoint: string | null | undefined,
    customerNotes: string | null | undefined,
): TWaterSourceType {
    const hint = `${samplingPoint ?? ''} ${customerNotes ?? ''}`.trim();

    if (hint !== '') {
        for (const { regex, type } of HINT_PATTERNS) {
            if (regex.test(hint)) return type;
        }
    }

    if (depthMeters !== null && depthMeters !== undefined && depthMeters > 0) {
        return depthMeters > WELL_DEPTH_THRESHOLD_METERS ? 'well' : 'well_dug';
    }

    return 'municipal';
}
