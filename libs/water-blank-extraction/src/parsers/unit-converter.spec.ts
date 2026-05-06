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
});
