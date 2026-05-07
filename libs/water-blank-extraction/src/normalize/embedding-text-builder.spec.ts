import { generateEmbeddingText, type TWaterAnalysisRecord } from './embedding-text-builder';

const baseRecord: TWaterAnalysisRecord = {
    intakeType: 'well',
    depthMeters: 50,
    appearance: null,
    params: {},
    paramUnits: {},
    paramFlags: {},
};

describe('generateEmbeddingText', () => {
    describe('header', () => {
        it('скважина с глубиной → "Скважина 50 м."', () => {
            const text = generateEmbeddingText({ ...baseRecord, depthMeters: 50, params: {} });
            expect(text).toMatch(/^Скважина 50 м\./);
        });

        it('колодец без глубины (depthMeters=null)', () => {
            const text = generateEmbeddingText({ ...baseRecord, intakeType: 'well_dug', depthMeters: null });
            expect(text).toMatch(/^Колодец\./);
        });

        it('центральный водопровод', () => {
            const text = generateEmbeddingText({ ...baseRecord, intakeType: 'municipal', depthMeters: null });
            expect(text).toMatch(/^Центральный водопровод\./);
        });

        it('родник', () => {
            const text = generateEmbeddingText({ ...baseRecord, intakeType: 'spring', depthMeters: null });
            expect(text).toMatch(/^Родник\./);
        });
    });

    describe('параметры — превышения и normal', () => {
        it('iron_total > ПДК → попадает в "Превышения ПДК"', () => {
            const text = generateEmbeddingText({
                ...baseRecord,
                params: { iron_total: 1.5 },
                paramUnits: { iron_total: 'мг/л' },
            });
            expect(text).toContain('Превышения ПДК:');
            expect(text).toContain('железо (fe, суммарно) 1.5 мг/л (превышение)');
        });

        it('iron_total < ПДК → попадает в "Прочие параметры"', () => {
            const text = generateEmbeddingText({
                ...baseRecord,
                params: { iron_total: 0.05 },
                paramUnits: { iron_total: 'мг/л' },
            });
            expect(text).toContain('Прочие параметры:');
            expect(text).toContain('железо (fe, суммарно) 0.05 мг/л');
            expect(text).not.toContain('Превышения ПДК:');
        });

        it('смешанный кейс — превышения + normal', () => {
            const text = generateEmbeddingText({
                ...baseRecord,
                params: {
                    iron_total: 1.5,         // > 0.3 ПДК → exceed
                    hardness_total: 8.2,     // > 7 ПДК → exceed
                    ph: 7.1,                 // в норме 6-9
                    nitrates: 3.0,           // < 45 ПДК → normal
                },
                paramUnits: {
                    iron_total: 'мг/л',
                    hardness_total: 'мг-экв/л',
                    ph: 'ед.',
                    nitrates: 'мг/л',
                },
            });
            expect(text).toContain('Превышения ПДК:');
            expect(text).toContain('железо (fe, суммарно)');
            expect(text).toMatch(/жёсткость общая.*превышение/i);
            expect(text).toContain('Прочие параметры:');
            expect(text).toContain('водородный показатель');
            expect(text).toContain('нитраты');
        });

        it('below_detection помечается отдельной аннотацией', () => {
            const text = generateEmbeddingText({
                ...baseRecord,
                params: { iron_total: 0.005 },
                paramUnits: { iron_total: 'мг/л' },
                paramFlags: { iron_total: ['below_detection'] },
            });
            expect(text).toContain('ниже предела детектирования');
        });

        it('pH вне диапазона (range exceedance) → превышение', () => {
            const text = generateEmbeddingText({
                ...baseRecord,
                params: { ph: 5.0 }, // ниже min 6
                paramUnits: { ph: 'ед.' },
            });
            expect(text).toMatch(/водородный показатель.*превышение/i);
        });
    });

    describe('appearance', () => {
        it('appearance добавляется отдельной фразой', () => {
            const text = generateEmbeddingText({
                ...baseRecord,
                appearance: 'мутная, мутнеет со временем',
            });
            expect(text).toContain('Внешний вид: мутная, мутнеет со временем.');
        });

        it('appearance null → секция отсутствует', () => {
            const text = generateEmbeddingText({ ...baseRecord, appearance: null });
            expect(text).not.toContain('Внешний вид:');
        });

        it('appearance пустая строка → секция отсутствует', () => {
            const text = generateEmbeddingText({ ...baseRecord, appearance: '   ' });
            expect(text).not.toContain('Внешний вид:');
        });
    });

    describe('реальный кейс из dataset', () => {
        it('типичный бланк скважины МО с превышениями Fe/Mn/hardness', () => {
            const text = generateEmbeddingText({
                intakeType: 'well',
                depthMeters: 50,
                appearance: 'мутнеет со временем',
                params: {
                    temperature: 18.5,
                    odor: 1,
                    ph: 7.2,
                    color: 35,                  // > 20 ПДК → exceed
                    turbidity: 5.2,             // > 2.6 ПДК → exceed
                    tds: 720,                   // < 1000 ПДК → normal
                    hardness_total: 8.2,        // > 7 ПДК → exceed
                    iron_total: 1.5,            // > 0.3 ПДК → exceed
                    manganese: 0.3,             // > 0.1 ПДК → exceed
                    magnesium: 35,              // < 50 ПДК → normal
                    nitrates: 12,               // < 45 ПДК → normal
                    fluorides: 0.8,             // < 1.5 ПДК → normal
                },
                paramUnits: {
                    temperature: '°C',
                    odor: 'балл',
                    ph: 'ед.',
                    color: 'градус',
                    turbidity: 'ЕМФ',
                    tds: 'мг/л',
                    hardness_total: 'мг-экв/л',
                    iron_total: 'мг/л',
                    manganese: 'мг/л',
                    magnesium: 'мг/л',
                    nitrates: 'мг/л',
                    fluorides: 'мг/л',
                },
                paramFlags: {},
            });

            // Header
            expect(text).toMatch(/^Скважина 50 м\./);

            // 5 превышений ПДК должны быть упомянуты
            expect(text).toContain('Превышения ПДК:');
            expect(text).toMatch(/цветность.*35.*превышение/i);
            expect(text).toMatch(/мутность.*5\.2.*превышение/i);
            expect(text).toMatch(/жёсткость.*8\.2.*превышение/i);
            expect(text).toMatch(/железо.*1\.5.*превышение/i);
            expect(text).toMatch(/марганец.*0\.3.*превышение/i);

            // Normal параметры
            expect(text).toContain('Прочие параметры:');
            expect(text).toMatch(/температура.*18/i);
            expect(text).toMatch(/нитраты.*12/i);

            // Внешний вид
            expect(text).toContain('Внешний вид: мутнеет со временем.');

            // Размер вменяемый — не пустой и не гигантский
            expect(text.length).toBeGreaterThan(100);
            expect(text.length).toBeLessThan(2000);
        });
    });

    describe('edge cases', () => {
        it('пустой params → только header', () => {
            const text = generateEmbeddingText(baseRecord);
            expect(text).toBe('Скважина 50 м.');
        });

        it('intakeType=other → "Источник воды"', () => {
            const text = generateEmbeddingText({ ...baseRecord, intakeType: 'other', depthMeters: null });
            expect(text).toMatch(/^Источник воды\./);
        });

        it('depth=0 → не пишем глубину', () => {
            const text = generateEmbeddingText({ ...baseRecord, depthMeters: 0 });
            expect(text).toBe('Скважина.');
        });

        it('paramUnits override (turbidity каолин) → используется override', () => {
            const text = generateEmbeddingText({
                ...baseRecord,
                params: { turbidity: 0.8 },
                paramUnits: { turbidity: 'мг/л (каолин)' },
            });
            expect(text).toContain('мг/л (каолин)');
        });

        it('unknown paramCode (не в WATER_PARAMS_BY_CODE) — игнорируется', () => {
            const text = generateEmbeddingText({
                ...baseRecord,
                params: { unknown_param: 100, iron_total: 0.05 },
                paramUnits: { unknown_param: 'мг/л', iron_total: 'мг/л' },
            });
            expect(text).toContain('железо');
            expect(text).not.toContain('unknown_param');
        });
    });

    describe('форматирование чисел', () => {
        it('малое число (0.005) форматируется без хвостовых нулей', () => {
            const text = generateEmbeddingText({
                ...baseRecord,
                params: { iron_total: 0.005 },
                paramUnits: { iron_total: 'мг/л' },
            });
            expect(text).toMatch(/0\.005/);
        });

        it('целое число форматируется без точки', () => {
            const text = generateEmbeddingText({
                ...baseRecord,
                params: { tds: 720 },
                paramUnits: { tds: 'мг/л' },
            });
            expect(text).toMatch(/720(?![\d.])/);
        });

        it('значение 1234 (>=100) — округление до целого', () => {
            const text = generateEmbeddingText({
                ...baseRecord,
                params: { tds: 1234.567 },
                paramUnits: { tds: 'мг/л' },
            });
            expect(text).toMatch(/1235|1234/);
        });
    });
});
