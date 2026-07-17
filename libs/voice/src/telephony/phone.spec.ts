import { isE164, normalizePhoneForTrunk } from './phone';

describe('normalizePhoneForTrunk', () => {
    it('убирает + у российского мобильного', () => {
        expect(normalizePhoneForTrunk('+79991234567')).toBe('79991234567');
    });

    it('терпит пробелы по краям', () => {
        expect(normalizePhoneForTrunk('  +79991234567  ')).toBe('79991234567');
    });

    it('не трогает номер другой страны', () => {
        expect(normalizePhoneForTrunk('+493012345678')).toBe('493012345678');
    });

    it('отвергает номер без +', () => {
        expect(() => normalizePhoneForTrunk('79991234567')).toThrow(/E.164/);
    });

    it('отвергает номер с 8 вместо +7 — типичная ошибка ввода', () => {
        expect(() => normalizePhoneForTrunk('89991234567')).toThrow(/E.164/);
    });

    it('отвергает буквы и разделители', () => {
        expect(() => normalizePhoneForTrunk('+7 (999) 123-45-67')).toThrow(/E.164/);
    });

    it('отвергает слишком короткий номер', () => {
        expect(() => normalizePhoneForTrunk('+7999')).toThrow(/E.164/);
    });

    it('отвергает пустую строку', () => {
        expect(() => normalizePhoneForTrunk('')).toThrow(/E.164/);
    });

    it('отвергает ведущий ноль после + (нет такой страны)', () => {
        expect(() => normalizePhoneForTrunk('+09991234567')).toThrow(/E.164/);
    });
});

describe('isE164', () => {
    it('принимает валидный номер', () => {
        expect(isE164('+79991234567')).toBe(true);
    });

    it('отвергает невалидный', () => {
        expect(isE164('8-999-123-45-67')).toBe(false);
    });
});
