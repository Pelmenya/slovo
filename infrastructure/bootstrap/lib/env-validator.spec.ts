import { validateBootstrapEnv } from './env-validator';

const VALID_ENV: NodeJS.ProcessEnv = {
    FLOWISE_API_URL: 'http://localhost:3130',
    FLOWISE_API_KEY: 'flowise-token',
    ANTHROPIC_API_KEY: 'sk-ant-xxx',
    OPENAI_API_KEY: 'sk-openai-xxx',
    POSTGRES_HOST: 'localhost',
    POSTGRES_PORT: '5432',
    POSTGRES_DB: 'slovo',
    POSTGRES_USER: 'slovo',
    POSTGRES_PASSWORD: 'pass',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_ACCESS_KEY: 'minio',
    S3_SECRET_KEY: 'minio-pass',
    S3_CATALOG_BUCKET: 'slovo-datasets',
};

describe('validateBootstrapEnv', () => {
    describe('happy path', () => {
        it('returns parsed env with all required fields', () => {
            const result = validateBootstrapEnv(VALID_ENV);

            expect(result.flowiseApiUrl).toBe('http://localhost:3130');
            expect(result.flowiseApiKey).toBe('flowise-token');
            expect(result.anthropicApiKey).toBe('sk-ant-xxx');
            expect(result.openaiApiKey).toBe('sk-openai-xxx');
            expect(result.postgresHost).toBe('localhost');
            expect(result.postgresPort).toBe(5432);
            expect(result.postgresDb).toBe('slovo');
            expect(result.s3CatalogBucket).toBe('slovo-datasets');
        });

        it('defaults deploymentRegion to "dev" when not set', () => {
            const result = validateBootstrapEnv(VALID_ENV);
            expect(result.deploymentRegion).toBe('dev');
        });

        it('defaults forceRecreate to false when not set', () => {
            const result = validateBootstrapEnv(VALID_ENV);
            expect(result.forceRecreate).toBe(false);
        });

        it('accepts FORCE_RECREATE="1" → forceRecreate=true', () => {
            const result = validateBootstrapEnv({ ...VALID_ENV, FORCE_RECREATE: '1' });
            expect(result.forceRecreate).toBe(true);
        });

        it('accepts FORCE_RECREATE="true" → forceRecreate=true', () => {
            const result = validateBootstrapEnv({ ...VALID_ENV, FORCE_RECREATE: 'true' });
            expect(result.forceRecreate).toBe(true);
        });

        it('parses POSTGRES_PORT as number', () => {
            const result = validateBootstrapEnv({ ...VALID_ENV, POSTGRES_PORT: '6543' });
            expect(result.postgresPort).toBe(6543);
        });

        it('accepts deploymentRegion=eu without EU_PROXY_URL', () => {
            const result = validateBootstrapEnv({ ...VALID_ENV, DEPLOYMENT_REGION: 'eu' });
            expect(result.deploymentRegion).toBe('eu');
            expect(result.euProxyUrl).toBeNull();
        });

        it('accepts deploymentRegion=ru when EU_PROXY_URL provided', () => {
            const result = validateBootstrapEnv({
                ...VALID_ENV,
                DEPLOYMENT_REGION: 'ru',
                EU_PROXY_URL: 'http://eu-proxy:8888',
                EU_PROXY_AUTH: 'user:pass',
            });
            expect(result.deploymentRegion).toBe('ru');
            expect(result.euProxyUrl).toBe('http://eu-proxy:8888');
            expect(result.euProxyAuth).toBe('user:pass');
        });
    });

    describe('fail-fast validation', () => {
        it('throws when ANTHROPIC_API_KEY missing', () => {
            const env = { ...VALID_ENV };
            delete env.ANTHROPIC_API_KEY;
            expect(() => validateBootstrapEnv(env)).toThrow(/ANTHROPIC_API_KEY/);
        });

        it('throws when ANTHROPIC_API_KEY is empty string', () => {
            expect(() => validateBootstrapEnv({ ...VALID_ENV, ANTHROPIC_API_KEY: '' })).toThrow(
                /ANTHROPIC_API_KEY/,
            );
        });

        it('throws when ANTHROPIC_API_KEY is only whitespace', () => {
            expect(() => validateBootstrapEnv({ ...VALID_ENV, ANTHROPIC_API_KEY: '   ' })).toThrow(
                /ANTHROPIC_API_KEY/,
            );
        });

        it('throws when multiple required vars missing — lists all in error', () => {
            const env = { ...VALID_ENV };
            delete env.ANTHROPIC_API_KEY;
            delete env.OPENAI_API_KEY;
            delete env.S3_CATALOG_BUCKET;
            const err = (() => {
                try {
                    validateBootstrapEnv(env);
                    return null;
                } catch (e) {
                    return e instanceof Error ? e.message : String(e);
                }
            })();
            expect(err).toMatch(/ANTHROPIC_API_KEY/);
            expect(err).toMatch(/OPENAI_API_KEY/);
            expect(err).toMatch(/S3_CATALOG_BUCKET/);
        });

        it('throws when POSTGRES_PORT is not a number', () => {
            expect(() => validateBootstrapEnv({ ...VALID_ENV, POSTGRES_PORT: 'abc' })).toThrow(
                /POSTGRES_PORT.*valid port/,
            );
        });

        it('throws when POSTGRES_PORT is out of range', () => {
            expect(() => validateBootstrapEnv({ ...VALID_ENV, POSTGRES_PORT: '99999' })).toThrow(
                /POSTGRES_PORT/,
            );
            expect(() => validateBootstrapEnv({ ...VALID_ENV, POSTGRES_PORT: '0' })).toThrow(
                /POSTGRES_PORT/,
            );
        });

        it('throws when DEPLOYMENT_REGION is unknown value', () => {
            expect(() =>
                validateBootstrapEnv({ ...VALID_ENV, DEPLOYMENT_REGION: 'asia' }),
            ).toThrow(/DEPLOYMENT_REGION/);
        });

        it('throws when DEPLOYMENT_REGION=ru without EU_PROXY_URL', () => {
            expect(() =>
                validateBootstrapEnv({ ...VALID_ENV, DEPLOYMENT_REGION: 'ru' }),
            ).toThrow(/EU_PROXY_URL is required when DEPLOYMENT_REGION=ru/);
        });

        it('throws when DEPLOYMENT_REGION=ru with empty EU_PROXY_URL', () => {
            expect(() =>
                validateBootstrapEnv({
                    ...VALID_ENV,
                    DEPLOYMENT_REGION: 'ru',
                    EU_PROXY_URL: '   ',
                }),
            ).toThrow(/EU_PROXY_URL/);
        });
    });
});
