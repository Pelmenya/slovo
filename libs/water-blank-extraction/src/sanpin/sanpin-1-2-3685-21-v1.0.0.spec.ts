import { exceedsPdk, getParamUnit, WATER_PARAMS_BY_CODE } from './sanpin-1-2-3685-21-v1.0.0';

describe('exceedsPdk', () => {
    it('iron_total > 0.3 → true', () => {
        expect(exceedsPdk('iron_total', 0.5)).toBe(true);
    });

    it('iron_total < 0.3 → false', () => {
        expect(exceedsPdk('iron_total', 0.1)).toBe(false);
    });

    it('iron_total = 0.3 (на границе) → false (>, не ≥)', () => {
        expect(exceedsPdk('iron_total', 0.3)).toBe(false);
    });

    it('pH range type: 5.5 (ниже min) → true', () => {
        expect(exceedsPdk('ph', 5.5)).toBe(true);
    });

    it('pH range type: 7.5 (внутри 6-9) → false', () => {
        expect(exceedsPdk('ph', 7.5)).toBe(false);
    });

    it('pH range type: 9.5 (выше max) → true', () => {
        expect(exceedsPdk('ph', 9.5)).toBe(true);
    });

    it('unknown paramCode → null', () => {
        expect(exceedsPdk('unknown_param', 1)).toBeNull();
    });
});

describe('getParamUnit', () => {
    it('canonical fallback из справочника (paramUnits пустой)', () => {
        expect(getParamUnit('iron_total', {})).toBe(WATER_PARAMS_BY_CODE.iron_total.unit);
        expect(getParamUnit('hardness_total', {})).toBe(WATER_PARAMS_BY_CODE.hardness_total.unit);
    });

    it('paramUnits override берёт верх над справочником', () => {
        // Реальный кейс: turbidity по каолиновой методике вместо ЕМФ
        expect(getParamUnit('turbidity', { turbidity: 'мг/л (каолин)' })).toBe('мг/л (каолин)');
    });

    it('paramUnits canonical → возвращает то же самое (compat)', () => {
        expect(getParamUnit('iron_total', { iron_total: 'мг/л' })).toBe('мг/л');
    });

    it('paramUnits null/undefined → fallback на canonical', () => {
        expect(getParamUnit('iron_total', null)).toBe('мг/л');
        expect(getParamUnit('iron_total', undefined)).toBe('мг/л');
    });

    it('unknown paramCode + пустой paramUnits → null', () => {
        expect(getParamUnit('unknown_param', {})).toBeNull();
    });

    it('unknown paramCode но override в paramUnits → возвращает override', () => {
        expect(getParamUnit('unknown_param', { unknown_param: 'мг/л' })).toBe('мг/л');
    });
});
