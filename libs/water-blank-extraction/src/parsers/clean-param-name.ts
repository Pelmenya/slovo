// preCleanName — нормализует raw-имя параметра из text-layer Docling в форму,
// которая лукапится в PARAM_SYNONYMS. Vision-формы (`Нитраты (NO₃⁻)`) уже
// покрыты synonyms в unicode-виде; Docling возвращает разнесённые подстрочники
// (`Нитраты (по NO 3 - )`) и хочет pre-clean.
//
// Шаги (порядок важен):
//   1. NFKC normalize — компатибельная декомпозиция unicode (subscripts/superscripts
//      → обычные цифры/знаки, `⁻` U+207B → `−` U+2212).
//   2. Minus-unify — `−‒–—‐‑‒` варианты → ASCII `-` (NFKC превращает sup-минус
//      именно в U+2212, не в `-`).
//   3. Lowercase — synonyms key lookup case-insensitive.
//   4. Trim leading `)` — Docling cell-boundary jitter иногда переносит закрывающую
//      скобку в начало следующей строки (`) Окисляемость перманганатная`).
//   5. Dehyphenate letter-letter — фикс line-break artifacts типа
//      `Электропровод- ность` → `Электропроводность`. Только когда `-` окружён
//      буквами с двух сторон (иначе сломает `S 2- )` → `S 2)`).
//   6. Auto-close orphan `(` — если открывающих скобок больше чем закрывающих,
//      дописываем `)` в конец (`магний (mg 2+` → `магний (mg 2+)`). Прецедент:
//      152 кейса в bench_responses_gpu_full.
//   7. Внутри `(...)`: strip префикс `по ` (`(по NO3-)` → `(NO3-)`), Cyr→Lat
//      для chem-letters (`Н 2 S` → `H 2 S`), collapse spaces вокруг цифр/знаков
//      (`Mg 2+` → `Mg2+`).
//   8. Collapse outer multiple spaces.
//
// Reality check на топ-5 Docling unknown names (см. compare-full.md):
//   - `Магний (Mg 2+`        → `магний (mg2+)` — мапится в magnesium (новый synonym)
//   - `Реакция среды pH`     → `реакция среды ph` — мапится в ph (новый synonym)
//   - `Цветность, град`      → `цветность, град` — мапится в color (новый synonym)
//   - `Электропровод- ность` → `электропроводность` — мапится в electrical_conductivity
//   - `Фториды (по F)`       → `фториды (f)` — мапится в fluorides (новый synonym)

const MINUS_VARIANTS_REGEX = /[‐‑‒–—―−⁻₋]/g;

// Cyr ↔ Latin визуальные двойники, встречающиеся в химформулах.
// Применяется ТОЛЬКО внутри `(...)` — за пределами Cyr буквы могут быть
// легитимной кириллицей в слове («Сероводород», «Магний»).
//
// Lowercase pairs тоже включены потому что preCleanName делает lowercase ДО
// inside-parens обработки. Cyr lowercase `н` (U+043D) ≠ Latin `h` (U+0068)
// несмотря на визуальное сходство в monospace font.
const CYR_TO_LAT_MAP: Record<string, string> = {
    'Н': 'H', 'н': 'h',
    'С': 'C', 'с': 'c',
    'Р': 'P', 'р': 'p',
    'В': 'B', 'в': 'b',
    'М': 'M', 'м': 'm',
    'А': 'A', 'а': 'a',
    'Е': 'E', 'е': 'e',
    'К': 'K', 'к': 'k',
    'Т': 'T', 'т': 't',
    'О': 'O', 'о': 'o',
    'Х': 'X', 'х': 'x',
};

function unifyMinuses(s: string): string {
    return s.replace(MINUS_VARIANTS_REGEX, '-');
}

function trimLeadingClosingParen(s: string): string {
    return s.replace(/^\s*\)\s*/, '');
}

function dehyphenateLetterBreak(s: string): string {
    // `(letter)-\s+(letter)` → `$1$2`. Регексп с Unicode-property escapes требует
    // флага `u` — поддерживается с ES2018. Кириллица попадает под `\p{L}`.
    return s.replace(/(\p{L})-\s+(\p{L})/gu, '$1$2');
}

function autoCloseOrphanParen(s: string): string {
    let open = 0;
    let close = 0;
    for (const ch of s) {
        if (ch === '(') open++;
        else if (ch === ')') close++;
    }
    if (open > close) {
        return s + ')'.repeat(open - close);
    }
    return s;
}

function cleanInsideParens(s: string): string {
    return s.replace(/\(([^)]*)\)/g, (_match, inner: string) => {
        let content = inner;

        // 1. Strip leading `по ` (с пробелом или без): `по NO 3 -` или `поNO 3 -`.
        content = content.replace(/^\s*по\s*/i, '');

        // 2. Cyr chem letters → Latin — ТОЛЬКО для коротких runs (1-2 буквы).
        //    Reason: chem-letters это `H`, `S`, `Mg`, `Mn`, `Ca`, `Fe` — все ≤ 2.
        //    Длинные слова типа «суммарно» (8 букв) внутри `(Mn, суммарно)` —
        //    легитимный русский, мапить нельзя (превратилось бы в `cуmmapho`).
        content = content.replace(/[А-Яа-яёЁ]+/g, (token) => {
            if (token.length > 2) return token;
            let mapped = '';
            for (const ch of token) {
                const m = CYR_TO_LAT_MAP[ch];
                if (m === undefined) return token; // неизвестная Cyr буква — оставляем токен
                mapped += m;
            }
            return mapped;
        });

        // 3. Collapse пробелы между [letter|digit|sign] и [digit|sign|letter].
        //    Loop потому что после каждого replace окно сдвигается
        //    (`mg 2 +` → `mg2 +` → нужен ещё проход для `2 +` → `2+`).
        //    Конвергенция: каждый replace удаляет ≥1 пробел, длина строки строго
        //    уменьшается → loop сходится не более чем за len(content) итераций.
        //    Cap=8 — guard от патологичных кейсов (реально сходится за 1-3 прохода
        //    на всех bench_responses_gpu_full).
        for (let i = 0; i < 8; i++) {
            const before = content;
            content = content.replace(/([A-Za-z\d])\s+([\d+-])/g, '$1$2');
            content = content.replace(/([\d+-])\s+([A-Za-z\d])/g, '$1$2');
            if (content === before) break;
        }

        // 4. Trim внутренние края.
        content = content.trim();

        return '(' + content + ')';
    });
}

function collapseOuterSpaces(s: string): string {
    return s.replace(/\s+/g, ' ').trim();
}

/**
 * Нормализует raw-имя параметра из бланка (Docling text-layer или Vision)
 * в форму lookup'а в PARAM_SYNONYMS.
 *
 * Преобразование idempotent: `preCleanName(preCleanName(x)) === preCleanName(x)`.
 *
 * @param raw — сырое имя как из источника (`Магний (Mg 2+`, `Электропровод- ность`)
 * @returns нормализованная форма (`магний (mg2+)`, `электропроводность`)
 */
export function preCleanName(raw: string): string {
    if (!raw) return '';

    let s = raw.normalize('NFKC');
    s = unifyMinuses(s);
    s = s.toLowerCase();
    s = trimLeadingClosingParen(s);
    s = dehyphenateLetterBreak(s);
    s = autoCloseOrphanParen(s);
    s = cleanInsideParens(s);
    s = collapseOuterSpaces(s);

    return s;
}
