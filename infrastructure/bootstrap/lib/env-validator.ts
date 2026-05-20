/**
 * Fail-fast валидация required env vars для prod bootstrap.
 * Падаем ДО первого MCP вызова — иначе получим cryptic 401/404 от Flowise.
 */

export type TBootstrapEnv = {
    flowiseApiUrl: string;
    flowiseApiKey: string;
    anthropicApiKey: string;
    openaiApiKey: string;
    postgresHost: string;
    postgresPort: number;
    postgresDb: string;
    postgresUser: string;
    postgresPassword: string;
    s3Endpoint: string;
    s3AccessKey: string;
    s3SecretKey: string;
    s3CatalogBucket: string;
    /**
     * URL EU HTTP-proxy для исходящих к Anthropic/OpenAI.
     * Required в `DEPLOYMENT_REGION=ru` — РФ не имеет прямого доступа к LLM API.
     * Bootstrap НЕ использует proxy сам (только локальные Flowise calls), но
     * валидирует наличие — без него Flowise в проде упадёт при первом predict.
     */
    euProxyUrl: string | null;
    euProxyAuth: string | null;
    forceRecreate: boolean;
    deploymentRegion: 'ru' | 'eu' | 'dev';
};

const REQUIRED_VARS = [
    'FLOWISE_API_URL',
    'FLOWISE_API_KEY',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'POSTGRES_HOST',
    'POSTGRES_PORT',
    'POSTGRES_DB',
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
    'S3_ENDPOINT',
    'S3_ACCESS_KEY',
    'S3_SECRET_KEY',
    'S3_CATALOG_BUCKET',
] as const;

export function validateBootstrapEnv(env: NodeJS.ProcessEnv): TBootstrapEnv {
    const missing: string[] = [];
    for (const key of REQUIRED_VARS) {
        const value = env[key];
        if (!value || value.trim().length === 0) {
            missing.push(key);
        }
    }
    if (missing.length > 0) {
        throw new Error(
            `Bootstrap aborted: missing required env vars: ${missing.join(', ')}.\n` +
                `Check infrastructure/bootstrap/README.md → "Required env vars" table.`,
        );
    }

    const port = Number.parseInt(env.POSTGRES_PORT!, 10);
    if (Number.isNaN(port) || port < 1 || port > 65535) {
        throw new Error(`POSTGRES_PORT must be a valid port number, got "${env.POSTGRES_PORT}"`);
    }

    const region = (env.DEPLOYMENT_REGION ?? 'dev').toLowerCase();
    if (!['ru', 'eu', 'dev'].includes(region)) {
        throw new Error(
            `DEPLOYMENT_REGION must be one of: ru|eu|dev (got "${env.DEPLOYMENT_REGION}"). ` +
                `Default "dev" — only docker-compose локально.`,
        );
    }

    // EU proxy обязателен для РФ prod — без него Flowise упадёт на Anthropic call'ах
    const euProxyUrl = env.EU_PROXY_URL ?? null;
    const euProxyAuth = env.EU_PROXY_AUTH ?? null;
    if (region === 'ru' && (!euProxyUrl || euProxyUrl.trim().length === 0)) {
        throw new Error(
            `EU_PROXY_URL is required when DEPLOYMENT_REGION=ru. ` +
                `РФ не имеет прямого доступа к api.anthropic.com / api.openai.com. ` +
                `Подними EU VPS с tinyproxy/squid (см. infrastructure/eu-proxy/ TODO) ` +
                `и пропиши его URL.`,
        );
    }

    return {
        flowiseApiUrl: env.FLOWISE_API_URL!,
        flowiseApiKey: env.FLOWISE_API_KEY!,
        anthropicApiKey: env.ANTHROPIC_API_KEY!,
        openaiApiKey: env.OPENAI_API_KEY!,
        postgresHost: env.POSTGRES_HOST!,
        postgresPort: port,
        postgresDb: env.POSTGRES_DB!,
        postgresUser: env.POSTGRES_USER!,
        postgresPassword: env.POSTGRES_PASSWORD!,
        s3Endpoint: env.S3_ENDPOINT!,
        s3AccessKey: env.S3_ACCESS_KEY!,
        s3SecretKey: env.S3_SECRET_KEY!,
        s3CatalogBucket: env.S3_CATALOG_BUCKET!,
        euProxyUrl,
        euProxyAuth,
        forceRecreate: env.FORCE_RECREATE === '1' || env.FORCE_RECREATE === 'true',
        deploymentRegion: region as 'ru' | 'eu' | 'dev',
    };
}
