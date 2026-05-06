import { parseValue } from './value-parser';

describe('parseValue', () => {
    describe('базовые числа', () => {
        it('парсит RU-decimal с запятой', () => {
            expect(parseValue('7,2')).toEqual({ value: 7.2, flags: [] });
            expect(parseValue('0,01')).toEqual({ value: 0.01, flags: [] });
        });

        it('парсит EN-decimal с точкой', () => {
            expect(parseValue('7.2')).toEqual({ value: 7.2, flags: [] });
        });

        it('парсит целое число', () => {
            expect(parseValue('5')).toEqual({ value: 5, flags: [] });
            expect(parseValue('500')).toEqual({ value: 500, flags: [] });
        });

        it('тримит пробелы вокруг', () => {
            expect(parseValue('  7,2  ')).toEqual({ value: 7.2, flags: [] });
        });
    });

    describe('null / empty / NaN', () => {
        it('null → value=null, no flags', () => {
            expect(parseValue(null)).toEqual({ value: null, flags: [] });
        });

        it('undefined → value=null, no flags', () => {
            expect(parseValue(undefined)).toEqual({ value: null, flags: [] });
        });

        it('пустая строка → value=null, no flags', () => {
            expect(parseValue('')).toEqual({ value: null, flags: [] });
            expect(parseValue('   ')).toEqual({ value: null, flags: [] });
        });

        it('нечисловой текст без распознанных паттернов → value=null, no flags', () => {
            expect(parseValue('xyz')).toEqual({ value: null, flags: [] });
        });
    });

    describe('not detected', () => {
        it('«не обнаружено»', () => {
            expect(parseValue('не обнаружено')).toEqual({
                value: null,
                flags: ['not_detected'],
            });
        });

        it('«не обнаружен»', () => {
            expect(parseValue('не обнаружен')).toEqual({
                value: null,
                flags: ['not_detected'],
            });
        });

        it('«н.о.»', () => {
            expect(parseValue('н.о.')).toEqual({
                value: null,
                flags: ['not_detected'],
            });
        });

        it('«н. о.»', () => {
            expect(parseValue('н. о.')).toEqual({
                value: null,
                flags: ['not_detected'],
            });
        });

        it('«нет»', () => {
            expect(parseValue('нет')).toEqual({
                value: null,
                flags: ['not_detected'],
            });
        });

        it('«отсутствует»', () => {
            expect(parseValue('отсутствует')).toEqual({
                value: null,
                flags: ['not_detected'],
            });
        });

        it('case-insensitive', () => {
            expect(parseValue('НЕ ОБНАРУЖЕНО')).toEqual({
                value: null,
                flags: ['not_detected'],
            });
        });
    });

    describe('below detection «<X»', () => {
        it('«<0,01» → value=0.005, detectionLimit=0.01', () => {
            expect(parseValue('<0,01')).toEqual({
                value: 0.005,
                flags: ['below_detection'],
                detectionLimit: 0.01,
            });
        });

        it('«<0.05» с EN-decimal', () => {
            expect(parseValue('<0.05')).toEqual({
                value: 0.025,
                flags: ['below_detection'],
                detectionLimit: 0.05,
            });
        });

        it('«≤0,5» с символом ≤', () => {
            expect(parseValue('≤0,5')).toEqual({
                value: 0.25,
                flags: ['below_detection'],
                detectionLimit: 0.5,
            });
        });

        it('«< 0,01» с пробелом после знака', () => {
            expect(parseValue('< 0,01')).toEqual({
                value: 0.005,
                flags: ['below_detection'],
                detectionLimit: 0.01,
            });
        });

        it('«<abc» (битое значение) → value=null', () => {
            expect(parseValue('<abc')).toEqual({ value: null, flags: [] });
        });
    });

    describe('above limit «>X»', () => {
        it('«>10» → value=10 (нижняя граница), detectionLimit=10', () => {
            expect(parseValue('>10')).toEqual({
                value: 10,
                flags: ['above_limit'],
                detectionLimit: 10,
            });
        });

        it('«≥1000»', () => {
            expect(parseValue('≥1000')).toEqual({
                value: 1000,
                flags: ['above_limit'],
                detectionLimit: 1000,
            });
        });

        it('«>1,5» с RU-decimal', () => {
            expect(parseValue('>1,5')).toEqual({
                value: 1.5,
                flags: ['above_limit'],
                detectionLimit: 1.5,
            });
        });
    });

    describe('range «X-Y»', () => {
        it('«5-10» → median=7.5, rangeMin=5, rangeMax=10', () => {
            expect(parseValue('5-10')).toEqual({
                value: 7.5,
                flags: ['range'],
                rangeMin: 5,
                rangeMax: 10,
            });
        });

        it('«5,5-10,5» с RU-decimal', () => {
            expect(parseValue('5,5-10,5')).toEqual({
                value: 8,
                flags: ['range'],
                rangeMin: 5.5,
                rangeMax: 10.5,
            });
        });

        it('«5 - 10» с пробелами вокруг дефиса', () => {
            expect(parseValue('5 - 10')).toEqual({
                value: 7.5,
                flags: ['range'],
                rangeMin: 5,
                rangeMax: 10,
            });
        });

        it('инвертированный диапазон «10-5» → не распознаётся как range', () => {
            // max должен быть > min, иначе fallback на parseNumber → возвращает 10
            // (NaN от "-5" игнорируется, parseFloat читает первое число)
            expect(parseValue('10-5')).toEqual({ value: 10, flags: [] });
        });

        it('«5,5» (RU-decimal) НЕ путаем с диапазоном', () => {
            expect(parseValue('5,5')).toEqual({ value: 5.5, flags: [] });
        });
    });

    describe('реальные кейсы из dataset', () => {
        it('Железо общее «<0,01»', () => {
            const r = parseValue('<0,01');
            expect(r.value).toBe(0.005);
            expect(r.flags).toEqual(['below_detection']);
        });

        it('Жёсткость общая «7,47»', () => {
            expect(parseValue('7,47')).toEqual({ value: 7.47, flags: [] });
        });

        it('Железо общее «0,02»', () => {
            expect(parseValue('0,02')).toEqual({ value: 0.02, flags: [] });
        });

        it('Жёсткость «10,0»', () => {
            expect(parseValue('10,0')).toEqual({ value: 10, flags: [] });
        });
    });
});
