import { z } from 'zod';

const booleanFromString = z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true'));

const portFromString = z.coerce.number().int().min(1).max(65535);

export const envSchema = z
    .object({
        NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
        API_PORT: portFromString.default(3101),
        WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(5),
        CORS_ORIGIN: z.string().min(1, 'CORS_ORIGIN обязателен'),
        LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

        POSTGRES_HOST: z.string().min(1),
        POSTGRES_PORT: portFromString,
        POSTGRES_USER: z.string().min(1),
        POSTGRES_PASSWORD: z.string().min(1),
        POSTGRES_DB: z.string().min(1),
        DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\/.+/, 'DATABASE_URL должен начинаться с postgres:// или postgresql://'),

        REDIS_HOST: z.string().min(1),
        REDIS_PORT: portFromString,
        REDIS_PASSWORD: z.string().optional().default(''),

        RABBITMQ_HOST: z.string().min(1),
        RABBITMQ_PORT: portFromString,
        RABBITMQ_MANAGEMENT_PORT: portFromString,
        RABBITMQ_USER: z.string().min(1),
        RABBITMQ_PASSWORD: z.string().min(1),
        RABBITMQ_URL: z.string().regex(/^amqp:\/\/.+/, 'RABBITMQ_URL должен начинаться с amqp://'),

        FLOWISE_PORT: portFromString.default(3130),
        FLOWISE_API_URL: z.url().optional(),

        LANGFUSE_ENABLED: booleanFromString.default(false),
        LANGFUSE_PORT: portFromString.default(3100),
        LANGFUSE_HOST: z.url().optional(),
        LANGFUSE_PUBLIC_KEY: z.string().optional().default(''),
        LANGFUSE_SECRET_KEY: z.string().optional().default(''),
        LANGFUSE_POSTGRES_PORT: portFromString.default(5434),
        LANGFUSE_POSTGRES_USER: z.string().optional().default('langfuse'),
        LANGFUSE_POSTGRES_PASSWORD: z.string().optional().default(''),
        LANGFUSE_POSTGRES_DB: z.string().optional().default('langfuse'),
        LANGFUSE_NEXTAUTH_SECRET: z.string().optional().default(''),
        LANGFUSE_SALT: z.string().optional().default(''),
        LANGFUSE_ENCRYPTION_KEY: z.string().optional().default(''),

        PGADMIN_PORT: portFromString.default(5050),
        PGADMIN_DEFAULT_EMAIL: z.email().optional(),
        PGADMIN_DEFAULT_PASSWORD: z.string().optional(),
        REDIS_COMMANDER_PORT: portFromString.default(8081),

        ANTHROPIC_API_KEY: z.string().optional().default(''),
        ANTHROPIC_DEFAULT_MODEL: z.string().default('claude-sonnet-4-6'),
        ANTHROPIC_FAST_MODEL: z.string().default('claude-haiku-4-5'),

        EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
        EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1536),

        JWT_SECRET: z.string().min(1),
        JWT_EXPIRES_IN: z.string().default('7d'),

        THROTTLE_TTL: z.coerce.number().int().positive().default(60),
        THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
    })
    .superRefine((env, ctx) => {
        if (env.NODE_ENV !== 'production') {
            return;
        }
        const weakDefaults: Array<[keyof typeof env, string]> = [
            ['JWT_SECRET', 'change_me_in_production'],
            ['POSTGRES_PASSWORD', 'slovo_dev_password_change_me'],
            ['RABBITMQ_PASSWORD', 'slovo_dev_password_change_me'],
            ['LANGFUSE_POSTGRES_PASSWORD', 'langfuse_dev_password_change_me'],
        ];
        for (const [key, placeholder] of weakDefaults) {
            if (env[key] === placeholder) {
                ctx.addIssue({
                    code: 'custom',
                    path: [key],
                    message: `${key} имеет dev-дефолт в production — сгенерируй новый секрет`,
                });
            }
        }
        if (env.JWT_SECRET.length < 32) {
            ctx.addIssue({
                code: 'custom',
                path: ['JWT_SECRET'],
                message: 'JWT_SECRET в production должен быть ≥ 32 символов',
            });
        }
        if (env.CORS_ORIGIN.includes('*')) {
            ctx.addIssue({
                code: 'custom',
                path: ['CORS_ORIGIN'],
                message: 'CORS_ORIGIN не может содержать * в production',
            });
        }
        if (env.LANGFUSE_ENABLED) {
            for (const key of ['LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY', 'LANGFUSE_HOST'] as const) {
                if (!env[key]) {
                    ctx.addIssue({
                        code: 'custom',
                        path: [key],
                        message: `${key} обязателен когда LANGFUSE_ENABLED=true`,
                    });
                }
            }
        }
    });

export type AppEnv = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): AppEnv {
    const result = envSchema.safeParse(config);
    if (!result.success) {
        const lines = result.error.issues
            .map((issue) => `  - ${issue.path.join('.') || '<root>'}: ${issue.message}`)
            .join('\n');
        throw new Error(`Invalid environment configuration:\n${lines}`);
    }
    return result.data;
}
