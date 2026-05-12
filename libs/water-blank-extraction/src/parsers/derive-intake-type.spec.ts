import { deriveIntakeType } from './derive-intake-type';

describe('deriveIntakeType', () => {
    describe('hint-based (приоритет над depth)', () => {
        it('«родник» в samplingPoint → spring', () => {
            expect(deriveIntakeType(null, 'родник у поля', null)).toBe('spring');
        });

        it('«ключ» в customerNotes → spring', () => {
            expect(deriveIntakeType(null, null, 'ключ за деревней')).toBe('spring');
        });

        it('«из ключа» / «ключи» / «ключевая» — широкие формы → spring', () => {
            // Расширенный regex ловит word-форму с 0-1 суффиксной буквой
            // (ключ, ключи, ключа, ключе, ключу).
            expect(deriveIntakeType(null, 'из ключа', null)).toBe('spring');
            expect(deriveIntakeType(null, 'ключи бьют', null)).toBe('spring');
            expect(deriveIntakeType(null, null, 'к ключу шёл')).toBe('spring');
        });

        it('«ключевая» — 2+ суффикс, НЕ matches (известное ограничение)', () => {
            // Compromise чтобы не ломать «ракушки» / «закусочка». Если в данных
            // часто встречается «ключевая вода» — расширить regex отдельно.
            expect(deriveIntakeType(null, 'ключевая вода', null)).toBe('municipal');
        });

        it('«река» → river', () => {
            expect(deriveIntakeType(null, 'река Москва', null)).toBe('river');
        });

        it('«скважина» → well даже при depth < 25', () => {
            // Hint имеет приоритет над depth-threshold
            expect(deriveIntakeType(15, 'скважина 15 м', null)).toBe('well');
        });

        it('«артскважина» → well', () => {
            expect(deriveIntakeType(80, 'артскважина', null)).toBe('well');
        });

        it('«колодец» → well_dug', () => {
            expect(deriveIntakeType(null, 'колодец', null)).toBe('well_dug');
        });

        it('«колодца» (genitive) → well_dug', () => {
            expect(deriveIntakeType(null, 'из колодца', null)).toBe('well_dug');
        });

        it('«из крана» → municipal', () => {
            expect(deriveIntakeType(null, 'из крана на кухне', null)).toBe('municipal');
        });

        it('«водопровод» → municipal', () => {
            expect(deriveIntakeType(null, 'городской водопровод', null)).toBe('municipal');
        });

        it('hint в customerNotes тоже видится', () => {
            expect(deriveIntakeType(null, null, 'отбор из родника')).toBe('spring');
        });

        it('оба поля null/undefined → не hint-match', () => {
            // Падаем в default (municipal — depth тоже нет)
            expect(deriveIntakeType(null, null, null)).toBe('municipal');
            expect(deriveIntakeType(null, undefined, undefined)).toBe('municipal');
        });
    });

    describe('depth-based fallback — threshold=15м (Tuned on 15504 Vision-labels, 2026-05-12)', () => {
        it('depth > 15 → well', () => {
            expect(deriveIntakeType(60, null, null)).toBe('well');
            expect(deriveIntakeType(80, null, null)).toBe('well');
            expect(deriveIntakeType(16, null, null)).toBe('well');
            // 16.5 — типичный middle от диапазона «Глубина 15-18 м»
            expect(deriveIntakeType(16.5, null, null)).toBe('well');
        });

        it('depth ≤ 15 → well_dug', () => {
            expect(deriveIntakeType(15, null, null)).toBe('well_dug');
            expect(deriveIntakeType(10, null, null)).toBe('well_dug');
            expect(deriveIntakeType(7.5, null, null)).toBe('well_dug');
            expect(deriveIntakeType(5, null, null)).toBe('well_dug');
        });

        it('depth = 0 → не используется (default municipal)', () => {
            expect(deriveIntakeType(0, null, null)).toBe('municipal');
        });

        it('depth = null → default municipal', () => {
            expect(deriveIntakeType(null, null, null)).toBe('municipal');
        });
    });

    describe('пограничные случаи', () => {
        it('пустые строки в samplingPoint/customerNotes не считаются hint', () => {
            expect(deriveIntakeType(60, '', '')).toBe('well');
            // 10 ≤ 15 → well_dug
            expect(deriveIntakeType(10, '   ', '   ')).toBe('well_dug');
        });

        it('hint «скважина» + большая глубина — оба сходятся в well', () => {
            expect(deriveIntakeType(60, 'скважина', null)).toBe('well');
        });

        it('hint «колодец» + средняя глубина — hint выигрывает, well_dug', () => {
            // Реальный кейс из dataset: «колодец с углублённой шахтой 30 м».
            // Hint доминирует — клиент явно сказал «колодец», не «скважина».
            expect(deriveIntakeType(30, 'колодец углублён', null)).toBe('well_dug');
        });

        it('multiple hints — выигрывает первый по приоритету (spring > well)', () => {
            // Маловероятный кейс «родник у скважины»: spring приоритетнее.
            expect(deriveIntakeType(60, 'родник у скважины', null)).toBe('spring');
        });
    });

    describe('deriveIntakeTypeWithSource — observability', () => {
        // Импортируем динамически чтобы не ломать существующие top-level imports.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { deriveIntakeTypeWithSource } = require('./derive-intake-type') as typeof import('./derive-intake-type');

        it('hint match → type + соответствующий source', () => {
            expect(deriveIntakeTypeWithSource(null, 'родник', null)).toEqual({
                type: 'spring',
                source: 'hint_spring',
            });
            expect(deriveIntakeTypeWithSource(null, 'скважина 60м', null)).toEqual({
                type: 'well',
                source: 'hint_well',
            });
            expect(deriveIntakeTypeWithSource(null, 'колодец', null)).toEqual({
                type: 'well_dug',
                source: 'hint_well_dug',
            });
            expect(deriveIntakeTypeWithSource(null, 'из крана', null)).toEqual({
                type: 'municipal',
                source: 'hint_municipal',
            });
            expect(deriveIntakeTypeWithSource(null, 'река Москва', null)).toEqual({
                type: 'river',
                source: 'hint_river',
            });
        });

        it('depth-based → depth_well или depth_well_dug', () => {
            expect(deriveIntakeTypeWithSource(60, null, null)).toEqual({
                type: 'well',
                source: 'depth_well',
            });
            expect(deriveIntakeTypeWithSource(10, null, null)).toEqual({
                type: 'well_dug',
                source: 'depth_well_dug',
            });
        });

        it('no depth + no hint → default_municipal', () => {
            expect(deriveIntakeTypeWithSource(null, null, null)).toEqual({
                type: 'municipal',
                source: 'default_municipal',
            });
            expect(deriveIntakeTypeWithSource(0, '', '')).toEqual({
                type: 'municipal',
                source: 'default_municipal',
            });
        });

        it('hint имеет приоритет над depth', () => {
            // hint=колодец, depth=60 (большая) — hint выигрывает
            expect(deriveIntakeTypeWithSource(60, 'колодец', null)).toEqual({
                type: 'well_dug',
                source: 'hint_well_dug',
            });
        });

        it('deriveIntakeType возвращает то же type что и deriveIntakeTypeWithSource', () => {
            // Контракт consistency между двумя API
            const cases: Array<[number | null, string | null, string | null]> = [
                [60, null, null],
                [10, null, null],
                [null, 'родник', null],
                [null, null, null],
                [30, 'колодец', null],
            ];
            for (const [d, sp, cn] of cases) {
                expect(deriveIntakeType(d, sp, cn)).toBe(
                    deriveIntakeTypeWithSource(d, sp, cn).type,
                );
            }
        });
    });
});
