// Placeholder-значения в тестах намеренно похожи на реальные секреты
// (правильный формат по длине/префиксу), чтобы регекс matched именно
// боевые патерны. Они НЕ являются реальными ключами — префикс
// `test-only-` в assertions и отсутствие реальных хвостов убеждают.

import {
    MAX_SANITIZED_ERROR_LENGTH,
    REDACTED_TOKEN,
    sanitizeIngestionError,
} from './sanitize-ingestion-error';

describe('sanitizeIngestionError', () => {
    it('возвращает пустую строку для undefined/null без падения', () => {
        expect(sanitizeIngestionError(undefined)).toBe('undefined');
        expect(sanitizeIngestionError(null)).toBe('null');
    });

    it('возвращает исходное сообщение из Error.stack', () => {
        const err = new Error('simple failure');
        const out = sanitizeIngestionError(err);
        expect(out).toContain('simple failure');
    });

    it('возвращает string-ошибку как есть', () => {
        expect(sanitizeIngestionError('plain text error')).toBe('plain text error');
    });

    it('сериализует объект ошибки', () => {
        expect(sanitizeIngestionError({ code: 500, msg: 'oops' })).toBe(
            '{"code":500,"msg":"oops"}',
        );
    });

    describe('редакция секретов', () => {
        it('AWS Access Key ID', () => {
            const out = sanitizeIngestionError('leaked AKIAIOSFODNN7EXAMPLE found');
            expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE');
            expect(out).toContain(REDACTED_TOKEN);
        });

        it('X-Amz-Signature в presigned URL', () => {
            const url = 'https://s3.amazonaws.com/b/k?X-Amz-Signature=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef&rest';
            const out = sanitizeIngestionError(url);
            expect(out).not.toContain('0123456789abcdef');
            expect(out).toContain(REDACTED_TOKEN);
            expect(out).toContain('rest');
        });

        it('X-Amz-Credential не попадает в лог', () => {
            const out = sanitizeIngestionError(
                'url=...&X-Amz-Credential=AKIAXXX/20260423/us-east-1/s3/aws4_request&',
            );
            expect(out).not.toContain('AKIAXXX');
            expect(out).toContain(REDACTED_TOKEN);
        });

        it('Anthropic API key sk-ant-...', () => {
            const out = sanitizeIngestionError('401: sk-ant-api03-abcdefghij1234567890xyz invalid');
            expect(out).not.toContain('sk-ant-api03-abcdefghij');
            expect(out).toContain(REDACTED_TOKEN);
        });

        it('OpenAI API key sk-...', () => {
            const out = sanitizeIngestionError('sk-proj1234567890abcdefghij123');
            expect(out).not.toContain('1234567890abcdefghij');
            expect(out).toContain(REDACTED_TOKEN);
        });

        it('Bearer token в Authorization', () => {
            const out = sanitizeIngestionError(
                'Error: { Authorization: Bearer eyJh.payload.sig-with-dashes }',
            );
            expect(out).not.toContain('Bearer eyJh');
            expect(out).toContain(REDACTED_TOKEN);
        });

        it('Basic auth header', () => {
            const out = sanitizeIngestionError('Basic dXNlcjpwYXNzd29yZA==');
            expect(out).not.toContain('dXNlcjpwYXNzd29yZA');
            expect(out).toContain(REDACTED_TOKEN);
        });

        it('JWT в тексте', () => {
            const jwt =
                'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signaturePartAbc123';
            const out = sanitizeIngestionError(`token=${jwt} expired`);
            expect(out).not.toContain('eyJzdWIi');
            expect(out).toContain(REDACTED_TOKEN);
            expect(out).toContain('expired');
        });

        it('Postgres connection string с паролем', () => {
            const out = sanitizeIngestionError(
                'connect ECONNREFUSED postgresql://app:p4ssw0rd@db.example.com:5432/mydb',
            );
            expect(out).not.toContain('p4ssw0rd');
            expect(out).toContain(REDACTED_TOKEN);
            expect(out).toContain('db.example.com');
        });

        it('несколько патернов в одной строке — все редактируются', () => {
            const input =
                'Failed: AKIAIOSFODNN7EXAMPLE with Bearer eyJtokenhere.payload.sig123';
            const out = sanitizeIngestionError(input);
            expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE');
            expect(out).not.toContain('Bearer eyJ');
            // Оба заменены
            expect((out.match(new RegExp(REDACTED_TOKEN.replace(/\[|\]/g, '\\$&'), 'g')) ?? []).length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('ограничение длины', () => {
        it('обрезает сообщения длиннее MAX_SANITIZED_ERROR_LENGTH', () => {
            const huge = 'a'.repeat(MAX_SANITIZED_ERROR_LENGTH * 2);
            const out = sanitizeIngestionError(huge);
            expect(out.length).toBe(MAX_SANITIZED_ERROR_LENGTH);
            expect(out.endsWith('...')).toBe(true);
        });

        it('не трогает сообщения в пределах лимита', () => {
            const normal = 'a'.repeat(100);
            expect(sanitizeIngestionError(normal)).toBe(normal);
        });
    });
});
