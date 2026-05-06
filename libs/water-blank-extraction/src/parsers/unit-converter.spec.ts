import { normalizeUnit } from './unit-converter';

describe('normalizeUnit', () => {
    describe('temperature', () => {
        it('latin °C → °C', () => {
            expect(normalizeUnit('temperature', '°C')).toBe('°C');
        });

        it('cyrillic °С → °C', () => {
            expect(normalizeUnit('temperature', '°С')).toBe('°C');
        });

        it('case-insensitive', () => {
            expect(normalizeUnit('temperature', '°c')).toBe('°C');
        });
    });

    describe('color', () => {
        it('«градусы» → «градус»', () => {
            expect(normalizeUnit('color', 'градусы')).toBe('градус');
        });

        it('«град» → «градус»', () => {
            expect(normalizeUnit('color', 'град')).toBe('градус');
        });

        it('«градусов» → «градус»', () => {
            expect(normalizeUnit('color', 'градусов')).toBe('градус');
        });
    });

    describe('odor', () => {
        it('«баллы» → «балл»', () => {
            expect(normalizeUnit('odor', 'баллы')).toBe('балл');
        });

        it('«балла» → «балл»', () => {
            expect(normalizeUnit('odor', 'балла')).toBe('балл');
        });
    });

    describe('turbidity', () => {
        it('«ЕМФ» → «ЕМФ»', () => {
            expect(normalizeUnit('turbidity', 'ЕМФ')).toBe('ЕМФ');
        });

        it('«ед. мутности» → «ЕМФ»', () => {
            expect(normalizeUnit('turbidity', 'ед. мутности')).toBe('ЕМФ');
        });

        it('«ед.» → «ЕМФ»', () => {
            expect(normalizeUnit('turbidity', 'ед.')).toBe('ЕМФ');
        });

        it('NTU → ЕМФ', () => {
            expect(normalizeUnit('turbidity', 'NTU')).toBe('ЕМФ');
        });

        it('«мг/л» (каолин) → отдельная единица', () => {
            expect(normalizeUnit('turbidity', 'мг/л')).toBe('мг/л (каолин)');
        });
    });

    describe('permanganate_oxidizability', () => {
        it('«мг/л» → «мг/л»', () => {
            expect(normalizeUnit('permanganate_oxidizability', 'мг/л')).toBe('мг/л');
        });

        it('«мгО₂/л» (без пробела) → «мг/л»', () => {
            expect(normalizeUnit('permanganate_oxidizability', 'мгО₂/л')).toBe('мг/л');
        });

        it('«мг О₂/л» (с пробелом) → «мг/л»', () => {
            expect(normalizeUnit('permanganate_oxidizability', 'мг О₂/л')).toBe('мг/л');
        });

        it('«мгО/л» (OCR без двойки) → «мг/л»', () => {
            expect(normalizeUnit('permanganate_oxidizability', 'мгО/л')).toBe('мг/л');
        });
    });

    describe('hardness_total', () => {
        it('«мг-экв/л» → канонический', () => {
            expect(normalizeUnit('hardness_total', 'мг-экв/л')).toBe('мг-экв/л');
        });

        it('«°Ж» → «мг-экв/л» (1:1)', () => {
            expect(normalizeUnit('hardness_total', '°Ж')).toBe('мг-экв/л');
        });

        it('«мгэкв/л» (OCR без дефиса) → «мг-экв/л»', () => {
            expect(normalizeUnit('hardness_total', 'мгэкв/л')).toBe('мг-экв/л');
        });
    });

    describe('electrical_conductivity', () => {
        it('«мкСм/см» → канонический', () => {
            expect(normalizeUnit('electrical_conductivity', 'мкСм/см')).toBe('мкСм/см');
        });

        it('OCR-вариант «мкО/л» → «мкСм/см»', () => {
            expect(normalizeUnit('electrical_conductivity', 'мкО/л')).toBe('мкСм/см');
        });

        it('«мг-экв/л» (OCR confusion с жёсткостью) → null (mismatch)', () => {
            expect(normalizeUnit('electrical_conductivity', 'мг-экв/л')).toBeNull();
        });
    });

    describe('mg/l-параметры (железо, марганец, нитраты и пр.)', () => {
        it('iron_total «мг/л»', () => {
            expect(normalizeUnit('iron_total', 'мг/л')).toBe('мг/л');
        });

        it('manganese «мг/л»', () => {
            expect(normalizeUnit('manganese', 'мг/л')).toBe('мг/л');
        });

        it('iron_total «мг/дм³» → «мг/л»', () => {
            expect(normalizeUnit('iron_total', 'мг/дм³')).toBe('мг/л');
        });

        it('iron_total «мг О₂/л» (OCR-ошибка от окисляемости) → null', () => {
            expect(normalizeUnit('iron_total', 'мг О₂/л')).toBeNull();
        });
    });

    describe('alkalinity_total', () => {
        it('«мг-экв/л» → канонический', () => {
            expect(normalizeUnit('alkalinity_total', 'мг-экв/л')).toBe('мг-экв/л');
        });

        it('«ммоль/л» → «мг-экв/л» (для щёлочности 1:1)', () => {
            expect(normalizeUnit('alkalinity_total', 'ммоль/л')).toBe('мг-экв/л');
        });
    });

    describe('ph (часто без единицы)', () => {
        it('пустая строка → «ед.»', () => {
            expect(normalizeUnit('ph', '')).toBe('ед.');
        });

        it('«ед.» → «ед.»', () => {
            expect(normalizeUnit('ph', 'ед.')).toBe('ед.');
        });

        it('null → «ед.» (default)', () => {
            expect(normalizeUnit('ph', null)).toBe('ед.');
        });

        it('«ед. рН» (Аквафор-spelling, 100% бланков) → «ед.»', () => {
            expect(normalizeUnit('ph', 'ед. рН')).toBe('ед.');
        });

        it('«ед.рН» (без пробела) → «ед.»', () => {
            expect(normalizeUnit('ph', 'ед.рН')).toBe('ед.');
        });

        it('«ед. pH» (latin) → «ед.»', () => {
            expect(normalizeUnit('ph', 'ед. pH')).toBe('ед.');
        });
    });

    describe('неизвестный paramCode', () => {
        it('возвращает null', () => {
            expect(normalizeUnit('unknown_param', 'мг/л')).toBeNull();
        });
    });

    describe('NBSP regression (защита от no-op replace)', () => {
        // Прецедент 2026-05-06: NBSP-замена в lookup была no-op,
        // потому что regex / /g содержал literal пробел в исходнике.
        // Тесты ловят регресс если кто-то заменит \u00A0 на обычный пробел.

        it('NBSP в pH unit между ед. и рН → ед.', () => {
            const withNbsp = `ед.${'\u00A0'}рН`;
            expect(normalizeUnit('ph', withNbsp)).toBe('ед.');
        });

        it('NBSP в permanganate unit (мг<NBSP>О2/л) → мг/л', () => {
            const withNbsp = `мг${'\u00A0'}О₂/л`;
            expect(normalizeUnit('permanganate_oxidizability', withNbsp)).toBe('мг/л');
        });

        it('NBSP в начале/конце тримится', () => {
            const wrapped = `${'\u00A0'}мг/л${'\u00A0'}`;
            expect(normalizeUnit('iron_total', wrapped)).toBe('мг/л');
        });

        it('двойной NBSP collapse через regex \\s+ → один пробел', () => {
            const withDoubleNbsp = `ед.${'\u00A0'}${'\u00A0'}рН`;
            expect(normalizeUnit('ph', withDoubleNbsp)).toBe('ед.');
        });
    });
});
