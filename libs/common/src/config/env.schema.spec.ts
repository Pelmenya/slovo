// Все значения в тесте — namespaced test-only placeholders.
// Ничего реального здесь быть не должно (см. security-auditor агент).
// Префикс "test-only-" делает их однозначно идентифицируемыми в grep / PR-diff.

import { validateEnv } from './env.schema';

const BASE_ENV: Record<string, string> = {
    NODE_ENV: 'development',
    API_PORT: '3101',
    CORS_ORIGIN: 'http://localhost:3000',
    LOG_LEVEL: 'info',
    POSTGRES_HOST: 'localhost',
    POSTGRES_PORT: '5433',
    POSTGRES_USER: 'test-only-pg-user',
    POSTGRES_PASSWORD: 'test-only-pg-password',
    POSTGRES_DB: 'test-only-db',
    DATABASE_URL: 'postgresql://test-only-pg-user:test-only-pg-password@localhost:5433/test-only-db',
    REDIS_HOST: 'localhost',
    REDIS_PORT: '6380',
    RABBITMQ_HOST: 'localhost',
    RABBITMQ_PORT: '5672',
    RABBITMQ_MANAGEMENT_PORT: '15672',
    RABBITMQ_USER: 'test-only-rmq-user',
    RABBITMQ_PASSWORD: 'test-only-rmq-password',
    RABBITMQ_URL: 'amqp://test-only-rmq-user:test-only-rmq-password@localhost:5672',
    JWT_SECRET: 'test-only-jwt-secret-'.padEnd(40, 'x'),
    S3_ACCESS_KEY: 'test-only-s3-access',
    S3_SECRET_KEY: 'test-only-s3-secret',
    S3_BUCKET: 'test-only-bucket',
    MINIO_ROOT_USER: 'test-only-minio-root-user',
    MINIO_ROOT_PASSWORD: 'test-only-minio-root-password',
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

    it('применяет S3/MinIO дефолты', () => {
        // Убираем MINIO_ROOT_USER чтобы проверить дефолт — в BASE_ENV он переопределён.
        const { MINIO_ROOT_USER: _, ...envNoUser } = BASE_ENV;
        const parsed = validateEnv(envNoUser);
        expect(parsed.S3_REGION).toBe('us-east-1');
        expect(parsed.S3_ENDPOINT).toBe('');
        expect(parsed.S3_FORCE_PATH_STYLE).toBe(true);
        expect(parsed.MINIO_PORT).toBe(9010);
        expect(parsed.MINIO_CONSOLE_PORT).toBe(9011);
        expect(parsed.MINIO_ROOT_USER).toBe('minioadmin');
    });

    it('падает если S3_BUCKET отсутствует', () => {
        const { S3_BUCKET: _, ...noBucket } = BASE_ENV;
        expect(() => validateEnv(noBucket)).toThrow(/S3_BUCKET/);
    });

    it('падает если MINIO_ROOT_PASSWORD отсутствует', () => {
        const { MINIO_ROOT_PASSWORD: _, ...noPwd } = BASE_ENV;
        expect(() => validateEnv(noPwd)).toThrow(/MINIO_ROOT_PASSWORD/);
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
                LANGFUSE_PUBLIC_KEY: 'test-only-langfuse-public-key',
                LANGFUSE_SECRET_KEY: 'test-only-langfuse-secret-key',
                LANGFUSE_HOST: 'https://langfuse.example.com',
            });
            expect(parsed.LANGFUSE_ENABLED).toBe(true);
        });

        it('падает если S3_ACCESS_KEY = dev-дефолт minioadmin', () => {
            expect(() =>
                validateEnv({
                    ...PROD_BASE,
                    S3_ACCESS_KEY: 'minioadmin',
                }),
            ).toThrow(/S3_ACCESS_KEY/);
        });

        it('падает если S3_SECRET_KEY = dev-дефолт', () => {
            expect(() =>
                validateEnv({
                    ...PROD_BASE,
                    S3_SECRET_KEY: 'slovo_dev_minio_password_change_me',
                }),
            ).toThrow(/S3_SECRET_KEY/);
        });

        it('падает если MINIO_ROOT_PASSWORD = dev-дефолт', () => {
            expect(() =>
                validateEnv({
                    ...PROD_BASE,
                    MINIO_ROOT_PASSWORD: 'slovo_dev_minio_password_change_me',
                }),
            ).toThrow(/MINIO_ROOT_PASSWORD/);
        });

        it('падает если MINIO_ROOT_USER = dev-дефолт minioadmin', () => {
            expect(() =>
                validateEnv({
                    ...PROD_BASE,
                    MINIO_ROOT_USER: 'minioadmin',
                }),
            ).toThrow(/MINIO_ROOT_USER/);
        });

        it('прод с сильными секретами — проходит', () => {
            const parsed = validateEnv({
                ...PROD_BASE,
                JWT_SECRET: 'test-only-prod-jwt-secret-'.padEnd(64, 'x'),
                POSTGRES_PASSWORD: 'test-only-prod-pg-password',
                RABBITMQ_PASSWORD: 'test-only-prod-rmq-password',
            });
            expect(parsed.NODE_ENV).toBe('production');
        });

        it('падает если FLOWISE_API_URL задан, а FLOWISE_API_KEY пуст', () => {
            expect(() =>
                validateEnv({
                    ...PROD_BASE,
                    JWT_SECRET: 'test-only-prod-jwt-secret-'.padEnd(64, 'x'),
                    POSTGRES_PASSWORD: 'test-only-prod-pg-password',
                    RABBITMQ_PASSWORD: 'test-only-prod-rmq-password',
                    FLOWISE_API_URL: 'https://flowise.example.com',
                    // FLOWISE_API_KEY не задан
                }),
            ).toThrow(/FLOWISE_API_KEY/);
        });

        it('прод с FLOWISE_API_URL + FLOWISE_API_KEY — проходит', () => {
            const parsed = validateEnv({
                ...PROD_BASE,
                JWT_SECRET: 'test-only-prod-jwt-secret-'.padEnd(64, 'x'),
                POSTGRES_PASSWORD: 'test-only-prod-pg-password',
                RABBITMQ_PASSWORD: 'test-only-prod-rmq-password',
                FLOWISE_API_URL: 'https://flowise.example.com',
                FLOWISE_API_KEY: 'test-only-prod-flowise-key',
            });
            expect(parsed.FLOWISE_API_URL).toBe('https://flowise.example.com');
            expect(parsed.FLOWISE_API_KEY).toBe('test-only-prod-flowise-key');
        });

        it('прод без FLOWISE_API_URL — FLOWISE_API_KEY не требуется', () => {
            const parsed = validateEnv({
                ...PROD_BASE,
                JWT_SECRET: 'test-only-prod-jwt-secret-'.padEnd(64, 'x'),
                POSTGRES_PASSWORD: 'test-only-prod-pg-password',
                RABBITMQ_PASSWORD: 'test-only-prod-rmq-password',
            });
            expect(parsed.FLOWISE_API_URL).toBeUndefined();
            expect(parsed.FLOWISE_API_KEY).toBe('');
        });
    });

    describe('FLOWISE_API_KEY (dev режим)', () => {
        it('default empty string — apps/api без Flowise integration работает', () => {
            const parsed = validateEnv(BASE_ENV);
            expect(parsed.FLOWISE_API_KEY).toBe('');
        });

        it('передан явно — сохраняется', () => {
            const parsed = validateEnv({
                ...BASE_ENV,
                FLOWISE_API_KEY: 'test-only-dev-flowise-key',
            });
            expect(parsed.FLOWISE_API_KEY).toBe('test-only-dev-flowise-key');
        });
    });
});
