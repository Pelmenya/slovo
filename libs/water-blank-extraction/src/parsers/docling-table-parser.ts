// docling-table-parser — конвертирует ответ `/parse/tables` от docling-service
// в `TWaterBlankExtractionV1` (общий контракт Vision/Docling путей).
//
// Структура бланка Аквафор/Ефимов (22-23 × 8):
//   row 0: col0="1", col1="Заказчик (ФИО):",          col2=ФИО
//   row 1: col0="2", col1="Адрес объекта:",           col2=телефон+адрес (склейка)
//   row 2: col0="3", col1="Объект исследования:",     col2..6=ярлыки checkbox,
//                                                     col7="Глубина <N> м" или "Глубина м"
//   row 3: col0="4", col1="Описание внешнего вида:",  col2/col5/col6=checkbox labels
//                                                     (отмеченные становятся текстом)
//   row 4: col0="5 Дата забора воды <дата> г. Дата проведения испытаний: <дата> г."
//          (или col0="5 Дата отбора воды: <дата>", col5="Дата проведения испытаний: <дата>")
//   row 5: col0="№ пп", col1="Определяемые показатели", ...   ← разделитель шапки
//   row 6: col4="СанПиН 1.2.3685-21 Россия", col5/col6=EU/ВОЗ  ← подзаголовок норм
//   row 7+: параметры. col0=номер, col1=name, col2=unit, col3=value, col4..6=ПДК, col7=методика
//
// Для 15×5 шаблона лаборатории парсер падает в few-fields режим — собирает что
// нашёл (по label-pattern, не по абсолютным индексам), остальное null. Полная
// поддержка 15×5 — отдельный slice.
//
// Что НЕ извлекается из text-layer (для существующих 15504 берётся из БД,
// для будущих — деривируется отдельным `derive-intake-type.ts`):
//   - intakeType (checkbox state visual glyph, не текст) → null.
//     NB: Vision-Haiku видит state checkbox'а и возвращает intakeType точно.
//     Для **existing 15504** берём `visionPayload.intakeType` (sunk cost).
//     Для **новых** — `deriveIntakeType(depthMeters, samplingPoint, customerNotes)`.
//     Здесь возвращаем null чтобы вызывающая сторона явно сделала выбор.
//     Защитный pattern в Slice 3 `03b-extract-docling.ts`:
//     `result.intakeType = visionPayload?.intakeType ?? deriveIntakeType(...)`.
//   - labName (вне таблицы шапки, в header/footer документа)
//   - conclusionText (в отдельной таблице после параметров, не парсим)
//   - blankNumber (в шапке документа)
//
// `depthMeters` может быть null — это норма (бланк без указания глубины,
// 41% датасета). Downstream derive-intake-type или Vision-fallback справится.

import { preCleanName } from './clean-param-name';
import type { TWaterBlankExtractionV1 } from '../schemas/water-blank-extraction-v1';

export type TDoclingCell = {
    row: number;
    col: number;
    text: string;
};

export type TDoclingTable = {
    page?: number | null;
    num_rows: number;
    num_cols: number;
    cells: TDoclingCell[];
    markdown?: string;
};

export type TDoclingTablesResponse = {
    tables: TDoclingTable[];
    // snake_case — зеркало wire-формата Python `/parse/tables` (apps/docling).
    elapsed_ms?: number;
};

type TGrid = Map<string, string>;

const gridKey = (row: number, col: number): string => `${row},${col}`;

function buildGrid(table: TDoclingTable): TGrid {
    const grid: TGrid = new Map();
    for (const cell of table.cells) {
        const text = cell.text?.trim() ?? '';
        if (text === '') continue;
        grid.set(gridKey(cell.row, cell.col), text);
    }
    return grid;
}

function getCell(grid: TGrid, row: number, col: number): string | null {
    return grid.get(gridKey(row, col)) ?? null;
}

/**
 * Находит row-индексы шапки по pattern'у в col1 (label-based, устойчиво к
 * row jitter между шаблонами лабораторий).
 */
type THeaderRows = {
    customerRow: number | null;
    addressRow: number | null;
    intakeRow: number | null;
    appearanceRow: number | null;
    datesRow: number | null;
    paramsStartRow: number;  // дефолт 7 для 22×8 шаблона
};

function findHeaderRows(grid: TGrid, numRows: number): THeaderRows {
    let customerRow: number | null = null;
    let addressRow: number | null = null;
    let intakeRow: number | null = null;
    let appearanceRow: number | null = null;
    let datesRow: number | null = null;
    let separatorRow: number | null = null;

    for (let r = 0; r < numRows; r++) {
        const col0 = getCell(grid, r, 0) ?? '';
        const col1 = getCell(grid, r, 1) ?? '';
        const lowerCol1 = col1.toLowerCase();
        const lowerCol0 = col0.toLowerCase();

        if (customerRow === null && lowerCol1.includes('заказчик')) {
            customerRow = r;
        } else if (addressRow === null && lowerCol1.includes('адрес') && lowerCol1.includes('объект')) {
            addressRow = r;
        } else if (intakeRow === null && lowerCol1.includes('объект исследования')) {
            intakeRow = r;
        } else if (appearanceRow === null && lowerCol1.includes('внешн')) {
            appearanceRow = r;
        } else if (separatorRow === null && lowerCol0.startsWith('№ пп')) {
            separatorRow = r;
        }

        // Даты могут быть склеены в col0 ("5 Дата забора воды...") ИЛИ в col0+col5
        // ("5 Дата отбора воды: ..." | "Дата проведения испытаний: ...").
        if (datesRow === null && /дата\s+(?:отбора|забора|проведения)/i.test(col0 + ' ' + (getCell(grid, r, 5) ?? ''))) {
            datesRow = r;
        }
    }

    // Параметры начинаются через 2 строки после `№ пп` (row separator + row с СанПиН-метками).
    // Если separator не нашли — fallback на row 7 (типичный для 22×8 шаблона).
    const paramsStartRow = separatorRow !== null ? separatorRow + 2 : 7;

    return { customerRow, addressRow, intakeRow, appearanceRow, datesRow, paramsStartRow };
}

function parseCustomerName(grid: TGrid, row: number | null): string | null {
    if (row === null) return null;
    return getCell(grid, row, 2);
}

/**
 * Собирает все непустые ячейки строки начиная с `startCol` в один joined-string.
 * Docling-cells шапки часто разнесены: телефон в col 2, адрес в col 4, номер дома
 * в col 6 (фрагменты текста, попавшие в разные ячейки на этапе table-detection).
 * Без join'а парсер теряет половину адреса.
 */
function collectRowCells(grid: TGrid, row: number, numCols: number, startCol: number): string | null {
    const parts: string[] = [];
    for (let c = startCol; c < numCols; c++) {
        const t = getCell(grid, row, c);
        if (t) parts.push(t);
    }
    return parts.length > 0 ? parts.join(' ') : null;
}

/**
 * Разделяет телефон и адрес. Vision склеивает их в одно поле; Docling возвращает
 * куски в разных ячейках — `collectRowCells` уже их склеил перед нами.
 *
 * Phone должен начинаться со строгого prefix `+7|7|8` — иначе любая строка с
 * подряд идущими 10 цифрами (например, code заказа или OCR-мусор) распознается
 * как телефон. Цена строгости: «(962) 911-80-60» без prefix не парсится.
 */
function parsePhoneAndAddress(rawCell: string | null): { phone: string | null; address: string | null } {
    if (!rawCell) return { phone: null, address: null };

    const phoneRegex = /^\s*(?:\+?7|8)[\s-]?\(?(\d{3})\)?[\s-]?(\d{3})[\s-]?(\d{2})[\s-]?(\d{2})\b\s*/;
    const match = rawCell.match(phoneRegex);
    if (match) {
        const phone = match[0].trim();
        const address = rawCell.slice(match[0].length).trim();
        return {
            phone: phone === '' ? null : phone,
            address: address === '' ? null : address,
        };
    }

    return { phone: null, address: rawCell.trim() };
}

function parseDepthMeters(grid: TGrid, row: number | null, numCols: number): number | null {
    if (row === null) return null;
    // Ищем "Глубина <N> м" в любой ячейке этой строки (обычно col 7, но
    // на разных шаблонах может сдвинуться).
    //
    // Поддерживаемые формы (выявлены на 15504 Vision-labels, см.
    // experiments/.../scripts/99a-investigate-depth-loss.ts):
    //   - "Глубина 60 м"          → 60
    //   - "Глубина 7,5 м"         → 7.5
    //   - "Глубина 7-9 м"         → 8 (medium of range)
    //   - "Глубина 50-60 м"       → 55
    //   - "Глубина >50 м"         → 50 (strip modifier)
    //   - "Глубина ~50 м"         → 50
    //   - "Глубина 30 - 40 м"     → 35 (с пробелами вокруг dash)
    //   - "Глубина м" (no value)  → null
    //   - "Глубина 0 м"           → null (zero treated as missing)
    //
    // Regex шаги:
    //   1. Capture первое число + опц. модификатор `>`/`<`/`~` перед ним
    //   2. Опц. capture второе число для range (с любым dash-вариантом)
    //   3. Если range — возвращаем avg
    //
    // NB: range parser обязателен — 4.4% бланков (676/15504) имеют range-формы
    // в шапке («Глубина 50-60 м»), без range support они теряются как null.
    for (let c = 0; c < numCols; c++) {
        const text = getCell(grid, row, c);
        if (!text) continue;
        const m = text.match(
            /глубина\s*[~<>]?\s*(\d+(?:[,.]\d+)?)(?:\s*[-–—]\s*(\d+(?:[,.]\d+)?))?\s*м/i,
        );
        if (m) {
            const low = parseFloat(m[1].replace(',', '.'));
            if (!Number.isFinite(low) || low <= 0) continue;
            if (m[2]) {
                const high = parseFloat(m[2].replace(',', '.'));
                if (Number.isFinite(high) && high >= low) {
                    return (low + high) / 2;
                }
            }
            return low;
        }
    }
    return null;
}

function parseAppearance(grid: TGrid, row: number | null, numCols: number): string[] | null {
    if (row === null) return null;
    const items: string[] = [];
    // col 0 — номер строки ("4"), col 1 — label "Описание внешнего вида:" — оба skip.
    for (let c = 2; c < numCols; c++) {
        const text = getCell(grid, row, c);
        if (!text) continue;
        items.push(text);
    }
    return items.length > 0 ? items : null;
}

const DATE_REGEX = /(\d{1,2})\.(\d{1,2})\.(\d{4})/g;

type TDateMatch = { value: string; index: number };

function parseDateMatches(text: string): TDateMatch[] {
    const dates: TDateMatch[] = [];
    for (const match of text.matchAll(DATE_REGEX)) {
        const day = parseInt(match[1], 10);
        const month = parseInt(match[2], 10);
        const year = match[3];
        // Отбрасываем семантически невалидные даты («32.13.2025») — иначе пройдут
        // как структурно валидный ISO («2025-13-32») и сломают temporal queries.
        if (month < 1 || month > 12 || day < 1 || day > 31) continue;
        dates.push({
            value: `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`,
            index: match.index ?? 0,
        });
    }
    return dates;
}


function parseSampleAndTestDates(
    grid: TGrid,
    row: number | null,
    numCols: number,
): { sampleDate: string | null; testDate: string | null } {
    if (row === null) return { sampleDate: null, testDate: null };

    // Собираем все ячейки в этой строке.
    const cellsByCol: { col: number; text: string }[] = [];
    for (let c = 0; c < numCols; c++) {
        const text = getCell(grid, row, c);
        if (text) cellsByCol.push({ col: c, text });
    }

    let sampleDate: string | null = null;
    let testDate: string | null = null;

    // Positional match: каждой найденной дате назначаем ближайший предшествующий
    // label («Дата отбора/забора» → sample, «Дата проведения» → test).
    // Это устойчиво к invalid-дате с одной стороны: invalid не попадает в matches,
    // valid дата с другой стороны не «перетекает» в чужой slot.
    for (const { text } of cellsByCol) {
        const lower = text.toLowerCase();
        const sampleLabelRegex = /дата\s+(?:отбора|забора)/gi;
        const testLabelRegex = /дата\s+проведения/gi;
        const sampleLabels = [...lower.matchAll(sampleLabelRegex)].map((m) => m.index ?? 0);
        const testLabels = [...lower.matchAll(testLabelRegex)].map((m) => m.index ?? 0);
        const dates = parseDateMatches(text);

        for (const date of dates) {
            // Ближайший label с index <= date.index. Если есть оба типа,
            // выбираем тот что ближе (правее).
            const nearestSample = sampleLabels.filter((i) => i <= date.index).pop() ?? -1;
            const nearestTest = testLabels.filter((i) => i <= date.index).pop() ?? -1;
            if (nearestSample === -1 && nearestTest === -1) continue;
            if (nearestSample > nearestTest) {
                if (sampleDate === null) sampleDate = date.value;
            } else {
                if (testDate === null) testDate = date.value;
            }
        }

        if (sampleDate !== null && testDate !== null) break;
    }

    return { sampleDate, testDate };
}

/**
 * Извлекает params из таблицы — строки начиная с paramsStartRow.
 * Применяет preCleanName к col1 для последующего lookup в PARAM_SYNONYMS.
 */
function parseParams(
    grid: TGrid,
    paramsStartRow: number,
    numRows: number,
): TWaterBlankExtractionV1['params'] {
    const params: TWaterBlankExtractionV1['params'] = [];
    for (let r = paramsStartRow; r < numRows; r++) {
        const rawName = getCell(grid, r, 1);
        const rawValue = getCell(grid, r, 3);
        if (!rawName || !rawValue) continue;

        const name = preCleanName(rawName);
        if (name === '') continue;

        const unitRaw = getCell(grid, r, 2);

        params.push({
            name,
            valueRaw: rawValue,
            unitRaw: unitRaw ?? null,
        });
    }
    return params;
}

/**
 * Парсит ответ `/parse/tables` от docling-service в `TWaterBlankExtractionV1`.
 *
 * Если `tables` пуст — возвращает пустой контракт (params=[], все опц. поля null).
 * Вызывающая сторона определяет fallback на Vision (`/parse/detect → vision_fallback`).
 *
 * @param response — ответ docling-service `/parse/tables`
 * @returns структурированный extraction (как Vision возвращает), без `intakeType` —
 *          его деривирует `deriveIntakeType()` отдельным шагом.
 */
export function parseDoclingTables(response: TDoclingTablesResponse): TWaterBlankExtractionV1 {
    // Explicit null'ы (не undefined) для опциональных полей — спецификация
    // WaterBlankExtractionV1 разрешает оба варианта (z.nullish), но тесты и
    // downstream код ожидают null. Единообразие облегчает diff против Vision.
    const empty: TWaterBlankExtractionV1 = {
        blankNumber: null,
        sampleDate: null,
        testDate: null,
        customerName: null,
        customerPhone: null,
        objectAddress: null,
        intakeType: null,
        depthMeters: null,
        appearance: null,
        labName: null,
        samplingPoint: null,
        conclusionText: null,
        customerNotes: null,
        notes: null,
        params: [],
    };

    if (!response.tables || response.tables.length === 0) {
        return empty;
    }

    // Берём самую большую таблицу — для бланков Аквафор это всегда главная таблица.
    // (Иногда Docling выдаёт пару дополнительных мини-табличек на странице.)
    const mainTable = response.tables.reduce((biggest, t) =>
        t.cells.length > biggest.cells.length ? t : biggest,
    );

    const grid = buildGrid(mainTable);
    const { customerRow, addressRow, intakeRow, appearanceRow, datesRow, paramsStartRow } =
        findHeaderRows(grid, mainTable.num_rows);

    const customerName = parseCustomerName(grid, customerRow);
    // Адрес: ячейки col >= 2 строки могут содержать разнесённые куски (phone в col2,
    // адрес в col4, номер дома в col6) — собираем всё, потом phone-split.
    const { phone: customerPhone, address: objectAddress } = parsePhoneAndAddress(
        addressRow !== null
            ? collectRowCells(grid, addressRow, mainTable.num_cols, 2)
            : null,
    );
    const depthMeters = parseDepthMeters(grid, intakeRow, mainTable.num_cols);
    const appearance = parseAppearance(grid, appearanceRow, mainTable.num_cols);
    const { sampleDate, testDate } = parseSampleAndTestDates(grid, datesRow, mainTable.num_cols);
    const params = parseParams(grid, paramsStartRow, mainTable.num_rows);

    // intakeType остаётся null (`...empty` уже задал) — checkbox state не в text-layer,
    // derive отдельно (deriveIntakeType) для новых бланков; для existing — берём
    // visionPayload.intakeType из БД.
    return {
        ...empty,
        customerName,
        customerPhone,
        objectAddress,
        depthMeters,
        appearance,
        sampleDate,
        testDate,
        params,
    };
}
