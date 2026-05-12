import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseDoclingTables, type TDoclingTablesResponse, type TDoclingCell } from './docling-table-parser';

// ---------- helpers для synthetic grids ----------

function makeTable(rows: TDoclingCell[][]): TDoclingTablesResponse {
    const cells: TDoclingCell[] = [];
    let maxRow = 0;
    let maxCol = 0;
    for (const row of rows) {
        for (const cell of row) {
            cells.push(cell);
            if (cell.row > maxRow) maxRow = cell.row;
            if (cell.col > maxCol) maxCol = cell.col;
        }
    }
    return {
        tables: [
            {
                page: 1,
                num_rows: maxRow + 1,
                num_cols: maxCol + 1,
                cells,
            },
        ],
    };
}

function loadFixture(filename: string): TDoclingTablesResponse {
    const raw = readFileSync(join(__dirname, '__fixtures__', filename), 'utf-8');
    return JSON.parse(raw) as TDoclingTablesResponse;
}

// ---------- minimal header skeleton (used across multiple test groups) ----------

function minimalHeader(extras: TDoclingCell[] = []): TDoclingCell[] {
    return [
        { row: 0, col: 0, text: '1' },
        { row: 0, col: 1, text: 'Заказчик (ФИО):' },
        { row: 1, col: 0, text: '2' },
        { row: 1, col: 1, text: 'Адрес объекта исследования:' },
        { row: 2, col: 0, text: '3' },
        { row: 2, col: 1, text: 'Объект исследования:' },
        { row: 3, col: 0, text: '4' },
        { row: 3, col: 1, text: 'Описание внешнего вида:' },
        { row: 5, col: 0, text: '№ пп' },
        { row: 5, col: 1, text: 'Определяемые показатели' },
        ...extras,
    ];
}

// =============================================================================

describe('parseDoclingTables', () => {
    describe('edge cases', () => {
        it('пустой tables → empty extraction', () => {
            const result = parseDoclingTables({ tables: [] });
            expect(result.params).toEqual([]);
            expect(result.customerName).toBeNull();
            expect(result.objectAddress).toBeNull();
            expect(result.intakeType).toBeNull();
        });

        it('таблица без params (только шапка) → params=[]', () => {
            const result = parseDoclingTables(makeTable([minimalHeader()]));
            expect(result.params).toEqual([]);
        });

        it('multi-table response — выбирается самая большая таблица', () => {
            // Docling иногда выдаёт мини-таблицу шапки + основную таблицу бланка.
            // Документирует: parser берёт ту что с большим числом cells.
            // Покрывает branch t.cells.length > biggest.cells.length (line 308).
            const big = makeTable([
                minimalHeader([
                    { row: 0, col: 2, text: 'Иванов И.И.' },
                    { row: 7, col: 0, text: '1' },
                    { row: 7, col: 1, text: 'Температура' },
                    { row: 7, col: 2, text: 'C' },
                    { row: 7, col: 3, text: '15,0' },
                ]),
            ]);
            const tiny: TDoclingCell[] = [
                { row: 0, col: 0, text: 'mini' },
                { row: 0, col: 1, text: 'header' },
            ];
            const response: TDoclingTablesResponse = {
                tables: [
                    { page: 1, num_rows: 1, num_cols: 2, cells: tiny },
                    ...big.tables,
                ],
            };
            const result = parseDoclingTables(response);
            expect(result.customerName).toBe('Иванов И.И.');
            expect(result.params).toHaveLength(1);
        });

        it('row с пустым name после preCleanName → skip', () => {
            // Если col1 содержит только мусор который preCleanName сводит к ''
            // (например только пробелы или закрывающие скобки) — row пропускается.
            const result = parseDoclingTables(
                makeTable([
                    minimalHeader([
                        { row: 7, col: 1, text: '   ' },           // пустота
                        { row: 7, col: 3, text: '1,0' },
                        { row: 8, col: 1, text: 'Температура' },   // нормальный
                        { row: 8, col: 3, text: '18,0' },
                    ]),
                ]),
            );
            expect(result.params).toEqual([
                { name: 'температура', valueRaw: '18,0', unitRaw: null },
            ]);
        });
    });

    describe('header parsing — customerName', () => {
        it('берёт col2 из строки с "Заказчик"', () => {
            const result = parseDoclingTables(
                makeTable([minimalHeader([{ row: 0, col: 2, text: 'Лазарев С.А.' }])]),
            );
            expect(result.customerName).toBe('Лазарев С.А.');
        });
    });

    describe('header parsing — phone+address split', () => {
        it('Vision-склейка "8XXXXXXXXXX Город" → phone + address', () => {
            const result = parseDoclingTables(
                makeTable([
                    minimalHeader([
                        { row: 1, col: 2, text: '89001234567 Тестово' },
                    ]),
                ]),
            );
            expect(result.customerPhone).toBe('89001234567');
            expect(result.objectAddress).toBe('Тестово');
        });

        it('без телефона — всё → objectAddress', () => {
            const result = parseDoclingTables(
                makeTable([minimalHeader([{ row: 1, col: 2, text: 'Бараново' }])]),
            );
            expect(result.customerPhone).toBeNull();
            expect(result.objectAddress).toBe('Бараново');
        });

        it('+7 (XXX) XXX-XX-XX формат — разделяет', () => {
            const result = parseDoclingTables(
                makeTable([
                    minimalHeader([{ row: 1, col: 2, text: '+7 (900) 123-45-67 Тестово' }]),
                ]),
            );
            expect(result.customerPhone).toContain('900');
            expect(result.objectAddress).toBe('Тестово');
        });

        it('10 цифр без prefix 7|8 НЕ matches как phone (адрес целиком)', () => {
            // Регрессионный guard: до tightening regex'а строка типа
            // "1234567890 Адрес" парсилась как phone+address. Теперь — всё в адрес.
            const result = parseDoclingTables(
                makeTable([
                    minimalHeader([{ row: 1, col: 2, text: '1234567890 Адрес' }]),
                ]),
            );
            expect(result.customerPhone).toBeNull();
            expect(result.objectAddress).toBe('1234567890 Адрес');
        });

        it('multi-cell address join — phone в col2, адрес в col4, номер дома в col6', () => {
            // Реальный Docling-кейс: фрагменты адреса попадают в разные cells
            // (детектор таблицы разнёс «Тестовый р-н, д. Тестовая» и «№3»).
            // Парсер собирает все col >= 2 через collectRowCells перед phone-split.
            const result = parseDoclingTables(
                makeTable([
                    minimalHeader([
                        { row: 1, col: 2, text: '89001234567' },
                        { row: 1, col: 4, text: 'Тестовый р-н, д. Тестовая' },
                        { row: 1, col: 6, text: '№3' },
                    ]),
                ]),
            );
            expect(result.customerPhone).toBe('89001234567');
            expect(result.objectAddress).toBe('Тестовый р-н, д. Тестовая №3');
        });
    });

    describe('header parsing — depthMeters', () => {
        it('"Глубина 60 м" → 60', () => {
            const result = parseDoclingTables(
                makeTable([minimalHeader([{ row: 2, col: 7, text: 'Глубина 60 м' }])]),
            );
            expect(result.depthMeters).toBe(60);
        });

        it('"Глубина 7,5 м" (RU-decimal) → 7.5', () => {
            const result = parseDoclingTables(
                makeTable([minimalHeader([{ row: 2, col: 7, text: 'Глубина 7,5 м' }])]),
            );
            expect(result.depthMeters).toBe(7.5);
        });

        it('"Глубина м" (без значения) → null', () => {
            const result = parseDoclingTables(
                makeTable([minimalHeader([{ row: 2, col: 7, text: 'Глубина м' }])]),
            );
            expect(result.depthMeters).toBeNull();
        });

        it('"Глубина 7-9 м" (range) → medium = 8', () => {
            const result = parseDoclingTables(
                makeTable([minimalHeader([{ row: 2, col: 7, text: 'Глубина 7-9 м' }])]),
            );
            expect(result.depthMeters).toBe(8);
        });

        it('"Глубина 50-60 м" (range, обычная глубина) → 55', () => {
            const result = parseDoclingTables(
                makeTable([minimalHeader([{ row: 2, col: 7, text: 'Глубина 50-60 м' }])]),
            );
            expect(result.depthMeters).toBe(55);
        });

        it('"Глубина >50 м" (modifier) → 50 (strip modifier, берём число)', () => {
            const result = parseDoclingTables(
                makeTable([minimalHeader([{ row: 2, col: 7, text: 'Глубина >50 м' }])]),
            );
            expect(result.depthMeters).toBe(50);
        });

        it('"Глубина ~50 м" (approximation) → 50', () => {
            const result = parseDoclingTables(
                makeTable([minimalHeader([{ row: 2, col: 7, text: 'Глубина ~50 м' }])]),
            );
            expect(result.depthMeters).toBe(50);
        });

        it('"Глубина 30 - 40 м" (spaces around dash) → 35', () => {
            const result = parseDoclingTables(
                makeTable([minimalHeader([{ row: 2, col: 7, text: 'Глубина 30 - 40 м' }])]),
            );
            expect(result.depthMeters).toBe(35);
        });

        it('"Глубина 15-18 м" (range типичной мелкой well) → 16.5', () => {
            const result = parseDoclingTables(
                makeTable([minimalHeader([{ row: 2, col: 7, text: 'Глубина 15-18 м' }])]),
            );
            expect(result.depthMeters).toBe(16.5);
        });
    });

    describe('header parsing — sampleDate/testDate', () => {
        it('обе даты склеены в col0 row4', () => {
            const result = parseDoclingTables(
                makeTable([
                    minimalHeader([
                        {
                            row: 4,
                            col: 0,
                            text: '5 Дата забора воды 17.09.2025 г. Дата проведения испытаний: 18.09.2025 г.',
                        },
                    ]),
                ]),
            );
            expect(result.sampleDate).toBe('2025-09-17');
            expect(result.testDate).toBe('2025-09-18');
        });

        it('даты раздельно в col0 и col5', () => {
            const result = parseDoclingTables(
                makeTable([
                    minimalHeader([
                        { row: 4, col: 0, text: '5 Дата отбора воды: 06.10.2021г.' },
                        { row: 4, col: 5, text: 'Дата проведения испытаний: 08.10.2021г.' },
                    ]),
                ]),
            );
            expect(result.sampleDate).toBe('2021-10-06');
            expect(result.testDate).toBe('2021-10-08');
        });

        it('невалидная дата (32.13.2025) пропускается, валидная extracted', () => {
            // Защитный guard: семантически невалидная дата раньше превращалась
            // в `2025-13-32` (ISO-структурно валидный, семантически мусор) и
            // ломала temporal queries в downstream.
            const result = parseDoclingTables(
                makeTable([
                    minimalHeader([
                        {
                            row: 4,
                            col: 0,
                            text: '5 Дата отбора воды: 32.13.2025 г. Дата проведения испытаний: 18.09.2025 г.',
                        },
                    ]),
                ]),
            );
            // 32.13 отброшено, 18.09.2025 пройдёт как testDate. sampleDate=null.
            expect(result.sampleDate).toBeNull();
            expect(result.testDate).toBe('2025-09-18');
        });

        it('обе даты невалидны → null/null', () => {
            const result = parseDoclingTables(
                makeTable([
                    minimalHeader([
                        {
                            row: 4,
                            col: 0,
                            text: '5 Дата отбора 00.00.2025 г. Дата проведения 45.99.2025 г.',
                        },
                    ]),
                ]),
            );
            expect(result.sampleDate).toBeNull();
            expect(result.testDate).toBeNull();
        });
    });

    describe('header parsing — appearance', () => {
        it('собирает multi-checkbox строки в массив', () => {
            const result = parseDoclingTables(
                makeTable([
                    minimalHeader([
                        { row: 3, col: 2, text: 'Прозрачная' },
                        { row: 3, col: 5, text: 'Мутная' },
                        { row: 3, col: 6, text: 'Мутнеет со временем' },
                    ]),
                ]),
            );
            expect(result.appearance).toEqual(['Прозрачная', 'Мутная', 'Мутнеет со временем']);
        });

        it('пустая строка appearance → null', () => {
            const result = parseDoclingTables(makeTable([minimalHeader()]));
            expect(result.appearance).toBeNull();
        });
    });

    describe('params parsing', () => {
        it('базовый параметр — name через preCleanName + valueRaw + unitRaw', () => {
            const result = parseDoclingTables(
                makeTable([
                    minimalHeader([
                        { row: 7, col: 0, text: '1' },
                        { row: 7, col: 1, text: 'Температура' },
                        { row: 7, col: 2, text: '0 С' },
                        { row: 7, col: 3, text: '18,0' },
                    ]),
                ]),
            );
            expect(result.params).toEqual([
                { name: 'температура', valueRaw: '18,0', unitRaw: '0 С' },
            ]);
        });

        it('пропускает param row без value', () => {
            const result = parseDoclingTables(
                makeTable([
                    minimalHeader([
                        { row: 7, col: 1, text: 'Температура' },
                        { row: 7, col: 2, text: 'C' },
                        // col 3 пуст
                    ]),
                ]),
            );
            expect(result.params).toEqual([]);
        });

        it('Docling-формы химформул → ASCII после preClean', () => {
            const result = parseDoclingTables(
                makeTable([
                    minimalHeader([
                        { row: 7, col: 1, text: 'Магний (Mg 2+ )' },
                        { row: 7, col: 2, text: 'мг/л' },
                        { row: 7, col: 3, text: '50' },
                        { row: 8, col: 1, text: 'Сероводород (Н 2 S)' },
                        { row: 8, col: 2, text: 'мг/л' },
                        { row: 8, col: 3, text: '0,001' },
                        { row: 9, col: 1, text: 'Нитраты (по NO 3 - )' },
                        { row: 9, col: 2, text: 'мг/л' },
                        { row: 9, col: 3, text: '3,3' },
                        { row: 10, col: 1, text: 'Электропровод- ность' },
                        { row: 10, col: 2, text: 'мкСм/см' },
                        { row: 10, col: 3, text: '703' },
                    ]),
                ]),
            );
            expect(result.params).toEqual([
                { name: 'магний (mg2+)', valueRaw: '50', unitRaw: 'мг/л' },
                { name: 'сероводород (h2s)', valueRaw: '0,001', unitRaw: 'мг/л' },
                { name: 'нитраты (no3-)', valueRaw: '3,3', unitRaw: 'мг/л' },
                { name: 'электропроводность', valueRaw: '703', unitRaw: 'мкСм/см' },
            ]);
        });

        it('orphan ( "Магний (Mg 2+" → autoclose', () => {
            const result = parseDoclingTables(
                makeTable([
                    minimalHeader([
                        { row: 7, col: 1, text: 'Магний (Mg 2+' },
                        { row: 7, col: 2, text: 'мг/л' },
                        { row: 7, col: 3, text: '45' },
                    ]),
                ]),
            );
            expect(result.params).toEqual([
                { name: 'магний (mg2+)', valueRaw: '45', unitRaw: 'мг/л' },
            ]);
        });
    });

    describe('intakeType всегда null (derive отдельно)', () => {
        it('даже когда все 4 ярлыка в row 2 → intakeType=null', () => {
            const result = parseDoclingTables(
                makeTable([
                    minimalHeader([
                        { row: 2, col: 2, text: 'Центральный водопровод' },
                        { row: 2, col: 4, text: 'Местный водопровод' },
                        { row: 2, col: 5, text: 'Колодец' },
                        { row: 2, col: 6, text: 'Скважина' },
                        { row: 2, col: 7, text: 'Глубина 60 м' },
                    ]),
                ]),
            );
            expect(result.intakeType).toBeNull();
            expect(result.depthMeters).toBe(60);
        });
    });

    // =========================================================================
    // Integration tests на реальных bench_responses
    // =========================================================================

    describe('integration: реальные Docling responses (PII sanitized)', () => {
        it('fixture A (22×8, depthMeters=80, multi-cell адрес) — полный happy path', () => {
            const response = loadFixture('docling-fixture-a-22x8.json');
            const result = parseDoclingTables(response);

            expect(result.customerName).toBe('Иванов Иван Иванович');
            // Адресная строка: col2=phone, col4=geographic, col6=номер дома —
            // collectRowCells join'ит, phone-split извлекает phone, остальное → address.
            expect(result.customerPhone).toBe('89001234567');
            expect(result.objectAddress).toBe('Тестовый р-н, д. Тестовая №3');
            expect(result.depthMeters).toBe(80);
            expect(result.sampleDate).toBe('2021-09-28');
            expect(result.testDate).toBe('2021-09-29');
            expect(result.intakeType).toBeNull();

            // params: имена должны быть pre-cleaned, мапиться в PARAM_SYNONYMS
            // (проверяется в normalizer.spec.ts; здесь проверяем shape).
            const paramNames = result.params.map((p) => p.name);
            expect(paramNames).toContain('температура');
            expect(paramNames).toContain('магний (mg2+)');
            expect(paramNames).toContain('сероводород (h2s)');
            expect(paramNames).toContain('нитраты (no3-)');
            expect(paramNames).toContain('фториды (f-)');

            // 15 параметров в этом бланке (rows 7..21)
            expect(result.params).toHaveLength(15);
        });

        it('fixture B (23×8, телефон+адрес склейка, без depth)', () => {
            const response = loadFixture('docling-fixture-b-23x8-phone.json');
            const result = parseDoclingTables(response);

            expect(result.customerName).toBe('Петров Пётр Петрович');
            expect(result.customerPhone).toBe('89007654321');
            expect(result.objectAddress).toBe('Тестово');
            expect(result.depthMeters).toBeNull();  // "Глубина м" без значения
            expect(result.sampleDate).toBe('2025-09-17');
            expect(result.testDate).toBe('2025-09-18');
            expect(result.appearance).toEqual([
                'Прозрачная',
                'Мутная',
                'Мутнеет со временем',
            ]);

            // 16 параметров (rows 7..22)
            expect(result.params).toHaveLength(16);

            // Электропроводность - dehyphenate сработал
            const conductivity = result.params.find((p) =>
                p.name.includes('электропроводность'),
            );
            expect(conductivity).toBeDefined();
            expect(conductivity?.valueRaw).toBe('703');
        });
    });
});
