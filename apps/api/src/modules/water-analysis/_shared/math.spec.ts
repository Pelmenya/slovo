import { ageInYears, medianOfDistances, percentile, roundTo, weightedMean } from './math';

// =============================================================================
// Изолированные тесты shared math utilities. Раньше тестировались транзитивно
// через service-specs (testing-specialist 2026-05-08 flagged что edge-cases
// типа NaN/empty могут быть skipped — добавляем dedicated coverage).
// =============================================================================

describe('_shared/math', () => {
    // -----------------------------------------------------------------------
    // percentile — linear interpolation
    // -----------------------------------------------------------------------

    describe('percentile', () => {
        it('пустой массив → NaN', () => {
            expect(percentile([], 0.5)).toBeNaN();
            expect(percentile([], 0)).toBeNaN();
            expect(percentile([], 1)).toBeNaN();
        });

        it('один элемент → возвращает его на любом p', () => {
            expect(percentile([42], 0)).toBe(42);
            expect(percentile([42], 0.5)).toBe(42);
            expect(percentile([42], 1)).toBe(42);
        });

        it('два элемента — linear interp', () => {
            // [10, 30] на p=0.5 → idx=0.5, lo=0 hi=1, 10*0.5 + 30*0.5 = 20
            expect(percentile([10, 30], 0.5)).toBe(20);
            expect(percentile([10, 30], 0)).toBe(10);
            expect(percentile([10, 30], 1)).toBe(30);
            // p=0.25 → idx=0.25, lo=0 hi=1, 10*0.75 + 30*0.25 = 7.5+7.5 = 15
            expect(percentile([10, 30], 0.25)).toBe(15);
        });

        it('odd-length — middle element exact', () => {
            // [1,2,3,4,5] на p=0.5 → idx=2, lo=hi=2 → 3
            expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
        });

        it('even-length — interp между middle two', () => {
            // [1,2,3,4] на p=0.5 → idx=1.5, lo=1 hi=2 → 2*0.5 + 3*0.5 = 2.5
            expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
        });

        it('p=0.1 / p=0.9 для 11 элементов — на boundary', () => {
            const vs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
            // idx=10*0.1=1 → vs[1]=1
            expect(percentile(vs, 0.1)).toBe(1);
            // idx=10*0.9=9 → vs[9]=9
            expect(percentile(vs, 0.9)).toBe(9);
        });

        it('signature принимает readonly array', () => {
            const sorted: readonly number[] = [10, 20, 30];
            expect(percentile([...sorted], 0.5)).toBe(20);
        });
    });

    // -----------------------------------------------------------------------
    // roundTo — defensive NaN/Infinity → 0
    // -----------------------------------------------------------------------

    describe('roundTo', () => {
        it('обычные числа — стандартное округление', () => {
            expect(roundTo(0.42, 1)).toBe(0.4);
            expect(roundTo(0.45, 1)).toBe(0.5); // banker's? — JS Math.round 0.5 → 1
            expect(roundTo(7.123456, 2)).toBe(7.12);
            expect(roundTo(7.125, 2)).toBe(7.13);
        });

        it('digits=0 → integer', () => {
            expect(roundTo(7.7, 0)).toBe(8);
            expect(roundTo(7.4, 0)).toBe(7);
        });

        it('NaN → 0 (defensive)', () => {
            expect(roundTo(NaN, 2)).toBe(0);
            expect(roundTo(0 / 0, 4)).toBe(0);
        });

        it('Infinity / -Infinity → 0', () => {
            expect(roundTo(Infinity, 2)).toBe(0);
            expect(roundTo(-Infinity, 2)).toBe(0);
        });

        it('отрицательные числа — round to nearest', () => {
            expect(roundTo(-0.42, 1)).toBe(-0.4);
            expect(roundTo(-7.123, 2)).toBe(-7.12);
        });

        it('zero → zero', () => {
            expect(roundTo(0, 4)).toBe(0);
            expect(roundTo(-0, 2)).toBe(-0);
        });
    });

    // -----------------------------------------------------------------------
    // weightedMean
    // -----------------------------------------------------------------------

    describe('weightedMean', () => {
        it('равные веса → arithmetic mean', () => {
            expect(weightedMean([1, 2, 3, 4], [1, 1, 1, 1])).toBe(2.5);
            expect(weightedMean([10, 20], [5, 5])).toBe(15);
        });

        it('неравные веса — bias к более тяжёлым', () => {
            // values [10, 20], weights [3, 1] → (30+20)/4 = 12.5
            expect(weightedMean([10, 20], [3, 1])).toBe(12.5);
        });

        it('zero weight — игнорируется (численно)', () => {
            // values [10, 100], weights [1, 0] → (10+0)/(1+0) = 10
            expect(weightedMean([10, 100], [1, 0])).toBe(10);
        });

        it('все weights нулевые → NaN (caller проверяет)', () => {
            expect(weightedMean([1, 2, 3], [0, 0, 0])).toBeNaN();
            expect(weightedMean([1], [0])).toBeNaN();
        });

        it('пустые массивы → NaN (sumW=0)', () => {
            expect(weightedMean([], [])).toBeNaN();
        });

        it('один элемент с весом → значение', () => {
            expect(weightedMean([42], [5])).toBe(42);
            expect(weightedMean([42], [0.001])).toBe(42);
        });
    });

    // -----------------------------------------------------------------------
    // ageInYears
    // -----------------------------------------------------------------------

    describe('ageInYears', () => {
        it('today === sample → 0', () => {
            const d = new Date('2026-05-08T00:00:00.000Z');
            expect(ageInYears(d, d)).toBe(0);
        });

        it('1 год разница ≈ 1', () => {
            const today = new Date('2027-05-08T00:00:00.000Z');
            const sample = new Date('2026-05-08T00:00:00.000Z');
            expect(ageInYears(today, sample)).toBeCloseTo(1, 2);
        });

        it('5 лет разница ≈ 5', () => {
            const today = new Date('2026-05-08T00:00:00.000Z');
            const sample = new Date('2021-05-08T00:00:00.000Z');
            expect(ageInYears(today, sample)).toBeCloseTo(5, 1);
        });

        it('sample в будущем → отрицательный age', () => {
            const today = new Date('2026-01-01T00:00:00.000Z');
            const sample = new Date('2027-01-01T00:00:00.000Z');
            expect(ageInYears(today, sample)).toBeLessThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // medianOfDistances
    // -----------------------------------------------------------------------

    describe('medianOfDistances', () => {
        it('пустой массив → 0 (для UI «нет данных»)', () => {
            expect(medianOfDistances([])).toBe(0);
        });

        it('один элемент → этот элемент', () => {
            expect(medianOfDistances([4.7])).toBe(4.7);
        });

        it('odd-length — middle', () => {
            expect(medianOfDistances([1, 5, 3])).toBe(3);
        });

        it('even-length — interp', () => {
            expect(medianOfDistances([1, 2, 3, 4])).toBe(2.5);
        });

        it('сортирует входящий массив (не предполагает порядок)', () => {
            expect(medianOfDistances([10, 1, 5])).toBe(5);
            expect(medianOfDistances([3, 1, 4, 1, 5, 9, 2, 6])).toBe(3.5);
        });
    });
});
