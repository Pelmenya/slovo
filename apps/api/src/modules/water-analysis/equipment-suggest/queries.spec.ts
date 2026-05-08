import { WATER_PARAMS_BY_CODE } from '@slovo/water-blank-extraction';
import { GENERIC_FALLBACK_QUERY, getTargetedQueryForParam, PROBLEM_TO_QUERY } from './queries';

// =============================================================================
// PROBLEM_TO_QUERY mapping consistency + fallback test.
//
// Mapping напрямую формирует quality рекомендаций — drift между параметрами
// СанПиН и keys mapping означает что для нового regulated параметра уйдёт
// generic fallback вместо targeted technology query.
// =============================================================================

describe('equipment-suggest/queries', () => {
    describe('PROBLEM_TO_QUERY mapping coverage', () => {
        it('содержит keys для всех regulated paramCodes из СанПиН', () => {
            const regulatedCodes = Object.values(WATER_PARAMS_BY_CODE)
                .filter((p) => p.regulated && p.pdk !== null)
                .map((p) => p.paramCode);

            const missing = regulatedCodes.filter((code) => !(code in PROBLEM_TO_QUERY));

            // Если этот тест fail — добавили новый regulated paramCode в СанПиН
            // справочник, но забыли prompt в PROBLEM_TO_QUERY → recommendations
            // упадут в generic fallback. Решение: добавить targeted phrase в queries.ts.
            expect(missing).toEqual([]);
        });

        it('каждое значение — non-empty русская фраза', () => {
            for (const [code, query] of Object.entries(PROBLEM_TO_QUERY)) {
                expect(query.length).toBeGreaterThan(10);
                // Минимум одна кириллическая буква — проверка что прошло на embedding
                // эффективно (vision-augmented descriptions на русском).
                expect(query).toMatch(/[а-яА-Я]/);
                // Sanity — не содержит обратных слешей / template markers
                expect(query).not.toContain('${');
                expect(query).not.toContain('\\n');
                // Имя ключа valid paramCode (snake_case)
                expect(code).toMatch(/^[a-z_]+$/);
            }
        });
    });

    describe('getTargetedQueryForParam', () => {
        it('известный paramCode → targeted query из mapping', () => {
            expect(getTargetedQueryForParam('iron_total')).toBe(PROBLEM_TO_QUERY.iron_total);
            expect(getTargetedQueryForParam('hardness_total')).toBe(
                PROBLEM_TO_QUERY.hardness_total,
            );
            expect(getTargetedQueryForParam('nitrates')).toBe(PROBLEM_TO_QUERY.nitrates);
        });

        it('неизвестный paramCode → GENERIC_FALLBACK_QUERY', () => {
            expect(getTargetedQueryForParam('totally_unknown_param')).toBe(GENERIC_FALLBACK_QUERY);
            expect(getTargetedQueryForParam('')).toBe(GENERIC_FALLBACK_QUERY);
        });

        it('GENERIC_FALLBACK_QUERY — non-empty русская generic фраза', () => {
            expect(GENERIC_FALLBACK_QUERY.length).toBeGreaterThan(10);
            expect(GENERIC_FALLBACK_QUERY).toMatch(/[а-яА-Я]/);
        });
    });
});
