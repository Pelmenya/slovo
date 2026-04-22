import { validateEnv } from './env.schema';

const BASE_ENV: Record<string, string> = {
    NODE_ENV: 'development',
    API_PORT: '3101',
    CORS_ORIGIN: 'http://localhost:3000',
    LOG_LEVEL: 'info',
    POSTGRES_HOST: 'localhost',
    POSTGRES_PORT: '5433',
    POSTGRES_USER: 'slovo',
    POSTGRES_PASSWORD: 'pw',
    POSTGRES_DB: 'slovo',
    DATABASE_URL: 'postgresql://slovo:pw@localhost:5433/slovo',
    REDIS_HOST: 'localhost',
    REDIS_PORT: '6380',
    RABBITMQ_HOST: 'localhost',
    RABBITMQ_PORT: '5672',
    RABBITMQ_MANAGEMENT_PORT: '15672',
    RABBITMQ_USER: 'slovo',
    RABBITMQ_PASSWORD: 'pw',
    RABBITMQ_URL: 'amqp://slovo:pw@localhost:5672',
    JWT_SECRET: 'a'.repeat(40),
};

describe('validateEnv', () => {
    it('принимает валидный dev-набор', () => {
        const parsed = validateEnv(BASE_ENV);
        expect(parsed.API_PORT).toBe(3101);
        expect(parsed.NODE_ENV).toBe('development');
        expect(parsed.THROTTLE_LIMIT).toBe(100);
    });

    it('применяет дефолты для необязательных полей', () => {
        const parsed = validateEnv(BASE_ENV);
        expect(parsed.ANTHROPIC_DEFAULT_MODEL).toBe('claude-sonnet-4-6');
        expect(parsed.ANTHROPIC_FAST_MODEL).toBe('claude-haiku-4-5');
        expect(parsed.EMBEDDING_DIMENSIONS).toBe(1536);
        expect(parsed.LANGFUSE_ENABLED).toBe(false);
    });

    it('кастит строки с числами в числа', () => {
        const parsed = validateEnv({ ...BASE_ENV, THROTTLE_TTL: '120' });
        expect(parsed.THROTTLE_TTL).toBe(120);
    });

    it('падает на некорректном DATABASE_URL', () => {
        expect(() =>
            validateEnv({ ...BASE_ENV, DATABASE_URL: 'mysql://u:p@localhost/db' }),
        ).toThrow(/DATABASE_URL/);
    });

    it('падает на некорректном RABBITMQ_URL', () => {
        expect(() => validateEnv({ ...BASE_ENV, RABBITMQ_URL: 'http://localhost' })).toThrow(
            /RABBITMQ_URL/,
        );
    });

    it('падает если обязательное поле отсутствует', () => {
        const { JWT_SECRET: _, ...noJwt } = BASE_ENV;
        expect(() => validateEnv(noJwt)).toThrow(/JWT_SECRET/);
    });

    describe('production-валидация', () => {
        const PROD_BASE = { ...BASE_ENV, NODE_ENV: 'production' };

        it('падает если JWT_SECRET = dev-дефолт', () => {
            expect(() =>
                validateEnv({ ...PROD_BASE, JWT_SECRET: 'change_me_in_production' }),
            ).toThrow(/JWT_SECRET/);
        });

        it('падает если JWT_SECRET короче 32 символов', () => {
            expect(() => validateEnv({ ...PROD_BASE, JWT_SECRET: 'short' })).toThrow(/32/);
        });

        it('падает если POSTGRES_PASSWORD = dev-дефолт', () => {
            expect(() =>
                validateEnv({
                    ...PROD_BASE,
                    POSTGRES_PASSWORD: 'slovo_dev_password_change_me',
                }),
            ).toThrow(/POSTGRES_PASSWORD/);
        });

        it('падает если CORS_ORIGIN содержит *', () => {
            expect(() => validateEnv({ ...PROD_BASE, CORS_ORIGIN: '*' })).toThrow(/CORS_ORIGIN/);
            expect(() =>
                validateEnv({ ...PROD_BASE, CORS_ORIGIN: 'https://a.com,*' }),
            ).toThrow(/CORS_ORIGIN/);
        });

        it('при LANGFUSE_ENABLED=true требует все ключи', () => {
            expect(() => validateEnv({ ...PROD_BASE, LANGFUSE_ENABLED: 'true' })).toThrow(
                /LANGFUSE_/,
            );
        });

        it('LANGFUSE_ENABLED=true со всеми ключами — проходит', () => {
            const parsed = validateEnv({
                ...PROD_BASE,
                LANGFUSE_ENABLED: 'true',
                LANGFUSE_PUBLIC_KEY: 'pk',
                LANGFUSE_SECRET_KEY: 'sk',
                LANGFUSE_HOST: 'https://langfuse.example.com',
            });
            expect(parsed.LANGFUSE_ENABLED).toBe(true);
        });

        it('прод с сильными секретами — проходит', () => {
            const parsed = validateEnv({
                ...PROD_BASE,
                JWT_SECRET: 'x'.repeat(64),
                POSTGRES_PASSWORD: 'strong-password-x',
                RABBITMQ_PASSWORD: 'strong-password-y',
            });
            expect(parsed.NODE_ENV).toBe('production');
        });
    });
});
