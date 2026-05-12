import { preCleanName } from './clean-param-name';

describe('preCleanName', () => {
    describe('базовые нормализации', () => {
        it('пустая строка → пустая', () => {
            expect(preCleanName('')).toBe('');
        });

        it('lowercase + trim outer spaces', () => {
            expect(preCleanName('  Жёсткость Общая  ')).toBe('жёсткость общая');
        });

        it('collapse multiple inner spaces', () => {
            expect(preCleanName('Жёсткость   общая')).toBe('жёсткость общая');
        });

        it('идемпотентен (двойное применение не меняет результат)', () => {
            const cases = [
                'Магний (Mg 2+',
                'Электропровод- ность воды',
                ') Окисляемость перманганатная',
                'Нитраты (по NO 3 - )',
                'Сероводород (Н 2 S)',
            ];
            for (const input of cases) {
                const once = preCleanName(input);
                expect(preCleanName(once)).toBe(once);
            }
        });
    });

    describe('NFKC и минус-варианты', () => {
        it('NFKC разворачивает unicode subscripts и superscripts', () => {
            expect(preCleanName('Нитраты (NO₃⁻)')).toBe('нитраты (no3-)');
            expect(preCleanName('Сульфиды (S²⁻)')).toBe('сульфиды (s2-)');
            expect(preCleanName('Магний (Mg²⁺)')).toBe('магний (mg2+)');
        });

        it('U+2212 MINUS SIGN → ASCII -', () => {
            expect(preCleanName('Нитраты (NO3−)')).toBe('нитраты (no3-)');
        });

        it('en-dash / em-dash → ASCII -', () => {
            expect(preCleanName('Электропровод– ность')).toBe('электропроводность');
            expect(preCleanName('Электропровод— ность')).toBe('электропроводность');
        });
    });

    describe('dehyphenate letter-letter (line-break artifacts)', () => {
        it('Электропровод- ность → электропроводность', () => {
            expect(preCleanName('Электропровод- ность')).toBe('электропроводность');
        });

        it('Электропровод- ность воды → электропроводность воды', () => {
            expect(preCleanName('Электропровод- ность воды')).toBe('электропроводность воды');
        });

        it('не ломает дефис между буквой и не-буквой (S 2-) сохраняется при autoclose)', () => {
            // `S 2- ` без замыкающей скобки — autoclose добавит `)` после
            // collapse spaces внутри parens, результат `s2-`
            expect(preCleanName('Сульфиды (S 2- )')).toBe('сульфиды (s2-)');
        });
    });

    describe('trim leading закрывающая скобка', () => {
        it(') Окисляемость → окисляемость', () => {
            expect(preCleanName(') Окисляемость перманганатная')).toBe(
                'окисляемость перманганатная',
            );
        });

        it('  )  Окисляемость → окисляемость', () => {
            expect(preCleanName('  )  Окисляемость перманганатная')).toBe(
                'окисляемость перманганатная',
            );
        });
    });

    describe('auto-close orphan (', () => {
        it('Магний (Mg 2+ → магний (mg2+)', () => {
            expect(preCleanName('Магний (Mg 2+')).toBe('магний (mg2+)');
        });

        it('два открытых без закрытий → два закрытия в конце', () => {
            // Маловероятный реальный кейс, но проверяем что счётчик работает
            expect(preCleanName('foo (bar (baz')).toBe('foo (bar (baz))');
        });

        it('balanced parens не меняются', () => {
            expect(preCleanName('Магний (Mg2+)')).toBe('магний (mg2+)');
        });
    });

    describe('inside parens: strip "по"', () => {
        it('Нитраты (по NO 3 - ) → нитраты (no3-)', () => {
            expect(preCleanName('Нитраты (по NO 3 - )')).toBe('нитраты (no3-)');
        });

        it('Нитраты (поNO 3 - ) (без пробела после "по") → нитраты (no3-)', () => {
            expect(preCleanName('Нитраты (поNO 3 - )')).toBe('нитраты (no3-)');
        });

        it('Фториды (по F) → фториды (f)', () => {
            expect(preCleanName('Фториды (по F)')).toBe('фториды (f)');
        });

        it('"по" вне скобок остаётся', () => {
            expect(preCleanName('Запах при 20 по гост')).toBe('запах при 20 по гост');
        });
    });

    describe('inside parens: Cyr chem letters → Latin', () => {
        it('Сероводород (Н 2 S) → сероводород (h2s)', () => {
            // Cyrillic Н (U+041D) в формуле → ASCII h
            expect(preCleanName('Сероводород (Н 2 S)')).toBe('сероводород (h2s)');
        });

        it('Кальций (Са 2+) → кальций (ca2+) [Cyrillic С → Latin c]', () => {
            expect(preCleanName('Кальций (Са 2+)')).toBe('кальций (ca2+)');
        });

        it('Cyr буквы вне скобок НЕ маппятся (Сероводород остаётся как есть)', () => {
            // Если бы мы маппили глобально — было бы `cеpовoдopoд` (мешанина).
            // Проверяем что "Сероводород" вне скобок сохранён.
            expect(preCleanName('Сероводород (H2S)')).toBe('сероводород (h2s)');
        });

        it('неизвестная Cyr буква в коротком (≤2) Cyr-token внутри скобок — token возвращается без изменения', () => {
            // Покрывает fallback на line 98 (CYR_TO_LAT_MAP[ch] === undefined).
            // `Я` отсутствует в map → токен `Я` возвращается as-is.
            // Collapse-regex внутри parens работает между letter↔digit↔sign,
            // НЕ между letter↔letter, поэтому пробел между `я` и `h` сохраняется.
            // Документирует: parser не падает на нестандартных Cyr-символах
            // в parens; неизвестный Cyr-token остаётся в lowercase оригинале.
            expect(preCleanName('Параметр (Я H)')).toBe('параметр (я h)');
        });

        it('Cyr-token длиннее 2 букв внутри parens не маппится даже если все буквы в CYR_TO_LAT_MAP', () => {
            // Защита от ложных срабатываний на русских словах внутри parens.
            // `Мно` (3 буквы) — все три в CYR_TO_LAT_MAP, но length > 2 → не маппим
            // (превратилось бы в `mho`, мусор).
            expect(preCleanName('Параметр (Мно)')).toBe('параметр (мно)');
        });
    });

    describe('inside parens: collapse spaces вокруг digits/signs', () => {
        it('(Mg 2+ ) → (mg2+)', () => {
            expect(preCleanName('Магний (Mg 2+ )')).toBe('магний (mg2+)');
        });

        it('(NO 3 - ) → (no3-)', () => {
            expect(preCleanName('Нитраты (NO 3 - )')).toBe('нитраты (no3-)');
        });

        it('(S 2- ) → (s2-)', () => {
            expect(preCleanName('Сульфиды (S 2- )')).toBe('сульфиды (s2-)');
        });

        it('(Mn, суммарно) — запятая+пробел после слова сохраняются', () => {
            // collapse spaces только между letter↔digit↔sign, не letter↔letter
            expect(preCleanName('Марганец (Mn, суммарно)')).toBe(
                'марганец (mn, суммарно)',
            );
        });
    });

    describe('15×5 шаблон лаборатории', () => {
        it('Реакция среды pH → реакция среды ph', () => {
            expect(preCleanName('Реакция среды pH')).toBe('реакция среды ph');
        });

        it('Цветность, град → цветность, град', () => {
            expect(preCleanName('Цветность, град')).toBe('цветность, град');
        });
    });

    describe('реальные unicode-формы которые уже в synonyms', () => {
        // Эти формы Vision возвращает напрямую. preCleanName их не ломает.
        it('сохраняет Vision unicode после NFKC + lowercase', () => {
            expect(preCleanName('Нитраты (NO₃⁻)')).toBe('нитраты (no3-)');
            expect(preCleanName('Сероводород (H₂S)')).toBe('сероводород (h2s)');
        });
    });
});
