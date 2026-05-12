import { normalizeWaterParams } from './water-analysis-normalizer';

describe('normalizeWaterParams', () => {
    describe('happy path', () => {
        it('маппит известный параметр в paramCode + сохраняет каноническую единицу', () => {
            const result = normalizeWaterParams([
                { name: 'Железо общее', valueRaw: '0,02', unitRaw: 'мг/л' },
            ]);
            expect(result.params).toEqual({ iron_total: 0.02 });
            expect(result.paramUnits).toEqual({ iron_total: 'мг/л' });
            expect(result.paramFlags).toEqual({});
            expect(result.paramsUnknown).toEqual({});
        });

        it('обрабатывает несколько параметров в одном бланке', () => {
            const result = normalizeWaterParams([
                { name: 'Железо общее', valueRaw: '0,02', unitRaw: 'мг/л' },
                { name: 'Жёсткость общая', valueRaw: '7,47', unitRaw: 'мг-экв/л' },
                { name: 'pH', valueRaw: '7,2', unitRaw: 'ед.' },
            ]);
            expect(result.params).toEqual({
                iron_total: 0.02,
                hardness_total: 7.47,
                ph: 7.2,
            });
            expect(result.paramFlags).toEqual({});
            expect(result.paramsUnknown).toEqual({});
        });

        it('case-insensitive маппинг названий', () => {
            const result = normalizeWaterParams([
                { name: 'ЖЕЛЕЗО ОБЩЕЕ', valueRaw: '0,02', unitRaw: 'мг/л' },
                { name: 'железо общее', valueRaw: '0,03', unitRaw: 'мг/л' }, // дубль
            ]);
            expect(result.params).toEqual({ iron_total: 0.02 });
            expect(result.paramFlags).toEqual({ iron_total: ['duplicate'] });
        });

        it('OCR-вариант «Марганец (Mg²⁺)» — Mg = магний, формула однозначна → magnesium', () => {
            // Vision OCR-ошибка имени: «Магний (Mg²⁺)» прочитан как «Марганец (Mg²⁺)».
            // Формула Mg²⁺ корректна → синоним мапится в magnesium (не manganese).
            const result = normalizeWaterParams([
                { name: 'Марганец (Mg²⁺)', valueRaw: '50', unitRaw: 'мг/л' },
            ]);
            expect(result.params).toEqual({ magnesium: 50 });
        });

        describe('Docling text-layer формы (после preCleanName)', () => {
            // Docling возвращает разнесённые подстрочники + ASCII химформулы.
            // После `preCleanName` имя приходит сюда в lookup-форме —
            // эти тесты гарантируют что новые synonyms (`mg2+`/`mn2+`/`ca2+`/...)
            // не отвалятся при PR'ах на нормализатор.

            it('магний (mg2+) → magnesium [ASCII pair после preClean]', () => {
                const result = normalizeWaterParams([
                    { name: 'магний (mg2+)', valueRaw: '50', unitRaw: 'мг/л' },
                ]);
                expect(result.params).toEqual({ magnesium: 50 });
            });

            it('кальций (ca2+) → calcium [ASCII pair после preClean]', () => {
                const result = normalizeWaterParams([
                    { name: 'кальций (ca2+)', valueRaw: '120', unitRaw: 'мг/л' },
                ]);
                expect(result.params).toEqual({ calcium: 120 });
            });

            it('реакция среды ph → ph [15×5 шаблон лаборатории]', () => {
                const result = normalizeWaterParams([
                    { name: 'реакция среды ph', valueRaw: '7,2', unitRaw: 'ед.' },
                ]);
                expect(result.params).toEqual({ ph: 7.2 });
            });

            it('цветность, град → color [15×5 шаблон]', () => {
                const result = normalizeWaterParams([
                    { name: 'цветность, град', valueRaw: '15', unitRaw: 'градусы' },
                ]);
                expect(result.params).toEqual({ color: 15 });
            });

            it('фториды (f) → fluorides [после strip "по"]', () => {
                const result = normalizeWaterParams([
                    { name: 'фториды (f)', valueRaw: '0,7', unitRaw: 'мг/л' },
                ]);
                expect(result.params).toEqual({ fluorides: 0.7 });
            });

            it('электропроводность воды → electrical_conductivity [после dehyphenate]', () => {
                const result = normalizeWaterParams([
                    { name: 'электропроводность воды', valueRaw: '604', unitRaw: 'мкСм/см' },
                ]);
                expect(result.params).toEqual({ electrical_conductivity: 604 });
            });

            it('Mn/Mg OCR-confusion в ASCII варианте (марганец (mg2+)) → magnesium', () => {
                // Docling preClean даёт `марганец (mg2+)` — формула Mg однозначно магний.
                const result = normalizeWaterParams([
                    { name: 'марганец (mg2+)', valueRaw: '45', unitRaw: 'мг/л' },
                ]);
                expect(result.params).toEqual({ magnesium: 45 });
            });
        });
    });

    describe('флаги особых случаев', () => {
        it('below_detection: «<0,01» → 0.005 + флаг', () => {
            const result = normalizeWaterParams([
                { name: 'Железо общее', valueRaw: '<0,01', unitRaw: 'мг/л' },
            ]);
            expect(result.params).toEqual({ iron_total: 0.005 });
            expect(result.paramFlags).toEqual({ iron_total: ['below_detection'] });
        });

        it('above_limit: «>10» → 10 + флаг', () => {
            const result = normalizeWaterParams([
                { name: 'Жёсткость общая', valueRaw: '>10', unitRaw: 'мг-экв/л' },
            ]);
            expect(result.params).toEqual({ hardness_total: 10 });
            expect(result.paramFlags).toEqual({ hardness_total: ['above_limit'] });
        });

        it('range: «6-9» → 7.5 + флаг (для pH-диапазона)', () => {
            const result = normalizeWaterParams([
                { name: 'pH', valueRaw: '6-9', unitRaw: 'ед.' },
            ]);
            expect(result.params).toEqual({ ph: 7.5 });
            expect(result.paramFlags).toEqual({ ph: ['range'] });
        });

        it('not_detected: значение НЕ записывается в params, только флаг', () => {
            const result = normalizeWaterParams([
                { name: 'Сероводород', valueRaw: 'не обнаружено', unitRaw: 'мг/л' },
            ]);
            expect(result.params).toEqual({});
            expect(result.paramFlags).toEqual({ hydrogen_sulfide: ['not_detected'] });
        });

        it('unit_mismatch: значение записано, paramUnits НЕ заполнен (избегаем микса canonical+raw)', () => {
            const result = normalizeWaterParams([
                { name: 'Железо общее', valueRaw: '0,02', unitRaw: 'мг О₂/л' }, // не мг/л
            ]);
            expect(result.params).toEqual({ iron_total: 0.02 });
            expect(result.paramFlags).toEqual({ iron_total: ['unit_mismatch'] });
            expect(result.paramUnits).toEqual({}); // сырое значение НЕ копируется
        });

        it('combined: below_detection + unit_mismatch', () => {
            const result = normalizeWaterParams([
                { name: 'Железо общее', valueRaw: '<0,01', unitRaw: 'мг О₂/л' },
            ]);
            expect(result.params).toEqual({ iron_total: 0.005 });
            expect(result.paramFlags).toEqual({
                iron_total: ['below_detection', 'unit_mismatch'],
            });
            expect(result.paramUnits).toEqual({});
        });
    });

    describe('paramsUnknown', () => {
        it('неизвестное название параметра → paramsUnknown', () => {
            const result = normalizeWaterParams([
                { name: 'Кислотность общая', valueRaw: '5,5', unitRaw: 'мг-экв/л' },
            ]);
            expect(result.params).toEqual({});
            expect(result.paramsUnknown).toEqual({
                'Кислотность общая': {
                    valueRaw: '5,5',
                    unitRaw: 'мг-экв/л',
                    reason: 'no_synonym',
                },
            });
        });

        it('известное название но непарсимое значение → paramsUnknown', () => {
            const result = normalizeWaterParams([
                { name: 'Железо общее', valueRaw: 'мутно', unitRaw: 'мг/л' },
            ]);
            expect(result.params).toEqual({});
            expect(result.paramsUnknown).toEqual({
                'Железо общее': {
                    valueRaw: 'мутно',
                    unitRaw: 'мг/л',
                    reason: 'parse_failed',
                },
            });
        });
    });

    describe('дубли', () => {
        it('две записи одного paramCode → берём первую, помечаем флагом', () => {
            const result = normalizeWaterParams([
                { name: 'Железо общее', valueRaw: '0,02', unitRaw: 'мг/л' },
                { name: 'Железо', valueRaw: '0,03', unitRaw: 'мг/л' }, // тоже iron_total
            ]);
            expect(result.params).toEqual({ iron_total: 0.02 });
            expect(result.paramFlags).toEqual({ iron_total: ['duplicate'] });
        });

        it('три записи одного paramCode → флаг duplicate один раз', () => {
            const result = normalizeWaterParams([
                { name: 'Железо общее', valueRaw: '0,02', unitRaw: 'мг/л' },
                { name: 'Железо', valueRaw: '0,03', unitRaw: 'мг/л' },
                { name: 'Fe', valueRaw: '0,04', unitRaw: 'мг/л' },
            ]);
            expect(result.params).toEqual({ iron_total: 0.02 });
            expect(result.paramFlags).toEqual({ iron_total: ['duplicate'] });
        });
    });

    describe('Mg/Mn position-based disambiguation', () => {
        it('пара «Марганец» по ord: первый → magnesium, второй → manganese (структура бланка)', () => {
            // Бланки Аквафор: магний идёт ord 8-9, марганец — ord 11-12.
            // Когда Vision выдаёт оба как «Марганец», восстанавливаем по позиции.
            const result = normalizeWaterParams([
                { name: 'Марганец', valueRaw: '5,2', unitRaw: 'мг/л' },        // ord 0 = магний (мягкая вода)
                { name: 'Марганец', valueRaw: '0,03', unitRaw: 'мг/л' },       // ord 1 = марганец
            ]);
            expect(result.params).toEqual({ magnesium: 5.2, manganese: 0.03 });
            expect(result.paramFlags).toEqual({});
        });

        it('пара «Марганец 55» + «Марганец (Mn, суммарно) 1.18» — оба мапятся в manganese, первый по ord → magnesium', () => {
            const result = normalizeWaterParams([
                { name: 'Марганец', valueRaw: '55', unitRaw: 'мг/л' },
                { name: 'Марганец (Mn, суммарно)', valueRaw: '1,18', unitRaw: 'мг/л' },
            ]);
            expect(result.params).toEqual({ magnesium: 55, manganese: 1.18 });
            expect(result.paramFlags).toEqual({});
        });

        it('одиночный «Марганец» с value > 10 → magnesium (fallback на value-эвристику)', () => {
            const result = normalizeWaterParams([
                { name: 'Марганец', valueRaw: '55', unitRaw: 'мг/л' },
            ]);
            expect(result.params).toEqual({ magnesium: 55 });
        });

        it('одиночный «Марганец» с value ≤ 10 → manganese (значение ниже Mg-диапазона)', () => {
            const result = normalizeWaterParams([
                { name: 'Марганец', valueRaw: '3,1', unitRaw: 'мг/л' },
            ]);
            expect(result.params).toEqual({ manganese: 3.1 });
        });

        it('boundary value=10 (одиночный) → manganese (≤ MG_THRESHOLD)', () => {
            const result = normalizeWaterParams([
                { name: 'Марганец', valueRaw: '10', unitRaw: 'мг/л' },
            ]);
            expect(result.params).toEqual({ manganese: 10 });
        });

        it('boundary value=10.01 (одиночный) → magnesium (> MG_THRESHOLD)', () => {
            const result = normalizeWaterParams([
                { name: 'Марганец', valueRaw: '10,01', unitRaw: 'мг/л' },
            ]);
            expect(result.params).toEqual({ magnesium: 10.01 });
        });

        it('low Mg в мягкой воде: позиционная Mg=5.2 + Mn=0.03 (значения которые value-эвристика бы упустила)', () => {
            const result = normalizeWaterParams([
                { name: 'Марганец', valueRaw: '5,2', unitRaw: 'мг/л' },
                { name: 'Марганец', valueRaw: '0,03', unitRaw: 'мг/л' },
            ]);
            expect(result.params).toEqual({ magnesium: 5.2, manganese: 0.03 });
        });

        it('пара bare «Марганец» 55 + bare «Марганец» <0,01 → magnesium=55, manganese=0.005', () => {
            const result = normalizeWaterParams([
                { name: 'Марганец', valueRaw: '55', unitRaw: 'мг/л' },
                { name: 'Марганец', valueRaw: '<0,01', unitRaw: 'мг/л' },
            ]);
            expect(result.params).toEqual({ magnesium: 55, manganese: 0.005 });
            expect(result.paramFlags).toEqual({ manganese: ['below_detection'] });
        });
    });

    describe('Sulfides ↔ Sulfates Vision confusion', () => {
        it('«Сульфаты 0.004» (value < 1) → реклассифицирован в sulfides', () => {
            const result = normalizeWaterParams([
                { name: 'Сульфаты (SO₄²⁻)', valueRaw: '0,004', unitRaw: 'мг/л' },
            ]);
            expect(result.params).toEqual({ sulfides: 0.004 });
        });

        it('«Сульфаты 50» (value > 1) → остаётся sulfates (легитимный)', () => {
            const result = normalizeWaterParams([
                { name: 'Сульфаты (SO₄²⁻)', valueRaw: '50', unitRaw: 'мг/л' },
            ]);
            expect(result.params).toEqual({ sulfates: 50 });
        });

        it('boundary value=1 → sulfates (≥ 1 mg/l)', () => {
            const result = normalizeWaterParams([
                { name: 'Сульфаты', valueRaw: '1', unitRaw: 'мг/л' },
            ]);
            expect(result.params).toEqual({ sulfates: 1 });
        });

        it('boundary value=0.999 → sulfides (< 1 mg/l)', () => {
            const result = normalizeWaterParams([
                { name: 'Сульфаты', valueRaw: '0,999', unitRaw: 'мг/л' },
            ]);
            expect(result.params).toEqual({ sulfides: 0.999 });
        });
    });

    describe('Hardness recovery (расширенный) — мг-экв/л под любым именем', () => {
        it('«Электропроводность 10.79 мг-экв/л» → hardness_total', () => {
            const result = normalizeWaterParams([
                { name: 'Электропроводность', valueRaw: '10,79', unitRaw: 'мг-экв/л' },
            ]);
            expect(result.params).toEqual({ hardness_total: 10.79 });
        });

        it('«Окисляемость перманганатная 11.62 мг-экв/л» → hardness_total (Vision-галлюцинация)', () => {
            const result = normalizeWaterParams([
                { name: 'Окисляемость перманганатная', valueRaw: '11,62', unitRaw: 'мг-экв/л' },
            ]);
            expect(result.params).toEqual({ hardness_total: 11.62 });
        });

        it('«Электропроводность 845 мкСм/см» → остаётся electrical_conductivity', () => {
            const result = normalizeWaterParams([
                { name: 'Электропроводность', valueRaw: '845', unitRaw: 'мкСм/см' },
            ]);
            expect(result.params).toEqual({ electrical_conductivity: 845 });
        });

        it('legitimate «Окисляемость 2.0 мгО₂/л» → permanganate_oxidizability (unit правильный)', () => {
            const result = normalizeWaterParams([
                { name: 'Окисляемость перманганатная', valueRaw: '2,0', unitRaw: 'мгО₂/л' },
            ]);
            expect(result.params).toEqual({ permanganate_oxidizability: 2 });
        });

        it('legitimate «Жёсткость общая 5.81 мг-экв/л» → hardness_total (как обычно, не reclass)', () => {
            const result = normalizeWaterParams([
                { name: 'Жёсткость общая', valueRaw: '5,81', unitRaw: 'мг-экв/л' },
            ]);
            expect(result.params).toEqual({ hardness_total: 5.81 });
        });
    });

    describe('Электропроводность → Жёсткость reclassification (Vision OCR-смещение)', () => {
        it('«Электропроводность 10.79 мг-экв/л» → hardness_total (unit однозначен)', () => {
            const result = normalizeWaterParams([
                { name: 'Электропроводность', valueRaw: '10,79', unitRaw: 'мг-экв/л' },
            ]);
            expect(result.params).toEqual({ hardness_total: 10.79 });
            expect(result.paramFlags).toEqual({});
        });

        it('«Электропроводность 845 мкСм/см» → остаётся electrical_conductivity', () => {
            const result = normalizeWaterParams([
                { name: 'Электропроводность', valueRaw: '845', unitRaw: 'мкСм/см' },
            ]);
            expect(result.params).toEqual({ electrical_conductivity: 845 });
        });

        it('«Электропроводность 5.81 ммоль/л» → hardness_total', () => {
            const result = normalizeWaterParams([
                { name: 'Электропроводность', valueRaw: '5,81', unitRaw: 'ммоль/л' },
            ]);
            expect(result.params).toEqual({ hardness_total: 5.81 });
        });
    });

    describe('edge cases', () => {
        it('пустой массив → пустой результат', () => {
            const result = normalizeWaterParams([]);
            expect(result).toEqual({
                params: {},
                paramUnits: {},
                paramFlags: {},
                paramsUnknown: {},
            });
        });

        it('запись без name → игнор', () => {
            const result = normalizeWaterParams([
                { name: null, valueRaw: '0,02', unitRaw: 'мг/л' },
                { name: '', valueRaw: '0,02', unitRaw: 'мг/л' },
                { name: '   ', valueRaw: '0,02', unitRaw: 'мг/л' },
            ]);
            expect(result.params).toEqual({});
            expect(result.paramsUnknown).toEqual({});
        });

        it('пустой unitRaw не трактуется как unit_mismatch', () => {
            const result = normalizeWaterParams([
                { name: 'pH', valueRaw: '7,2', unitRaw: '' },
                { name: 'Железо общее', valueRaw: '0,02', unitRaw: null },
            ]);
            expect(result.params).toEqual({ ph: 7.2, iron_total: 0.02 });
            expect(result.paramFlags).toEqual({});
        });

        it('реальный смешанный кейс из dataset', () => {
            const result = normalizeWaterParams([
                { name: 'Железо общее', valueRaw: '<0,01', unitRaw: 'мг/л' },
                { name: 'Жёсткость общая', valueRaw: '7,47', unitRaw: 'мг-экв/л' },
                { name: 'pH', valueRaw: '7,2', unitRaw: '' },
                { name: 'Сероводород', valueRaw: 'не обнаружено', unitRaw: 'мг/л' },
                { name: 'Кислотность общая', valueRaw: '5,5', unitRaw: 'мг-экв/л' }, // unknown
                { name: 'Цветность', valueRaw: '20', unitRaw: 'градусы' },
            ]);
            expect(result.params).toEqual({
                iron_total: 0.005,
                hardness_total: 7.47,
                ph: 7.2,
                color: 20,
            });
            expect(result.paramFlags).toEqual({
                iron_total: ['below_detection'],
                hydrogen_sulfide: ['not_detected'],
            });
            expect(Object.keys(result.paramsUnknown)).toEqual(['Кислотность общая']);
        });
    });
});
