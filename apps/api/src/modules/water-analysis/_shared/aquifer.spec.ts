import { AQUIFER_MIN_NEIGHBORS, computeMostLikelyAquiferLayer } from './aquifer';

// =============================================================================
// Тесты shared aquifer-helper. AQUIFER_MIN_NEIGHBORS=5 (поднят с 3 в
// security-fix 2026-05-08 для PII hardening). 5 buckets границ AQUIFER_LAYERS:
//   0-15 / 15-50 / 50-100 / 100-200 / 200+
// =============================================================================

describe('_shared/aquifer', () => {
    describe('AQUIFER_MIN_NEIGHBORS', () => {
        it('=5 (PII hardening floor)', () => {
            expect(AQUIFER_MIN_NEIGHBORS).toBe(5);
        });
    });

    describe('computeMostLikelyAquiferLayer', () => {
        it('< 5 depths → undefined', () => {
            expect(computeMostLikelyAquiferLayer([])).toBeUndefined();
            expect(computeMostLikelyAquiferLayer([10])).toBeUndefined();
            expect(computeMostLikelyAquiferLayer([10, 20, 30, 40])).toBeUndefined();
        });

        it('exactly 5 depths → возвращает label', () => {
            expect(computeMostLikelyAquiferLayer([10, 20, 30, 40, 50])).toBeDefined();
        });

        it('median 0-15 → "0-15m / Верховодка"', () => {
            // 5 значений [5,7,10,12,14] → median=10
            expect(computeMostLikelyAquiferLayer([5, 7, 10, 12, 14])).toBe('0-15m / Верховодка');
        });

        it('median 15-50 → "15-50m / Песчаный"', () => {
            // [20,25,30,35,40] → median=30
            expect(computeMostLikelyAquiferLayer([20, 25, 30, 35, 40])).toBe('15-50m / Песчаный');
        });

        it('median 50-100 → "50-100m / Песчано-известняковый"', () => {
            // [60,70,75,80,90] → median=75
            expect(computeMostLikelyAquiferLayer([60, 70, 75, 80, 90])).toBe(
                '50-100m / Песчано-известняковый',
            );
        });

        it('median 100-200 → "100-200m / Известняковый"', () => {
            // [120,140,150,160,180] → median=150
            expect(computeMostLikelyAquiferLayer([120, 140, 150, 160, 180])).toBe(
                '100-200m / Известняковый',
            );
        });

        it('median ≥200 → "200m+ / Артезианский"', () => {
            // [220,240,250,260,280] → median=250
            expect(computeMostLikelyAquiferLayer([220, 240, 250, 260, 280])).toBe(
                '200m+ / Артезианский',
            );
        });

        it('boundary — median ровно 15 → "15-50m / Песчаный" (lower inclusive)', () => {
            // [10,12,15,18,20] → median=15
            expect(computeMostLikelyAquiferLayer([10, 12, 15, 18, 20])).toBe('15-50m / Песчаный');
        });

        it('boundary — median ровно 50 → "50-100m / Песчано-известняковый"', () => {
            expect(computeMostLikelyAquiferLayer([45, 48, 50, 55, 60])).toBe(
                '50-100m / Песчано-известняковый',
            );
        });

        it('сортирует входящие depths (не предполагает порядок)', () => {
            // [40,30,10,50,20] sorted → [10,20,30,40,50] median=30
            expect(computeMostLikelyAquiferLayer([40, 30, 10, 50, 20])).toBe('15-50m / Песчаный');
        });

        it('readonly array signature', () => {
            const depths: readonly number[] = [60, 70, 75, 80, 90];
            expect(computeMostLikelyAquiferLayer(depths)).toBe('50-100m / Песчано-известняковый');
        });
    });
});
