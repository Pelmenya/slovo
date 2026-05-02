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
        // Bearer token из Flowise UI → API Keys. Optional для dev (apps/api без
        // Flowise integration работает с пустым ключом). Для production-runtime
        // который ходит в Flowise REST — обязателен (см. superRefine ниже).
        FLOWISE_API_KEY: z.string().optional().default(''),

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

        // S3 / MinIO — хранилище сырых источников knowledge base.
        // В dev — MinIO через docker-compose (endpoint http://localhost:9010, force_path_style=true).
        // В prod — AWS S3 или совместимый (endpoint можно оставить пустым, SDK использует регион).
        S3_ENDPOINT: z.string().optional().default(''),
        S3_REGION: z.string().min(1).default('us-east-1'),
        S3_ACCESS_KEY: z.string().min(1),
        S3_SECRET_KEY: z.string().min(1),
        S3_BUCKET: z.string().min(1),
        // Bucket для catalog images (vision-catalog-search). Отдельный от
        // S3_BUCKET (knowledge uploads) потому что feeder'ы (CRM, 1С) пишут
        // картинки каталога в shared bucket с другим IAM-scope (см. ADR-007).
        // Default 'slovo-datasets' соответствует Phase 0 setup'у (lab journal).
        S3_CATALOG_BUCKET: z.string().min(1).default('slovo-datasets'),
        S3_FORCE_PATH_STYLE: booleanFromString.default(true),
        MINIO_PORT: portFromString.default(9010),
        MINIO_CONSOLE_PORT: portFromString.default(9011),
        MINIO_ROOT_USER: z.string().min(1).default('minioadmin'),
        MINIO_ROOT_PASSWORD: z.string().min(1),

        JWT_SECRET: z.string().min(1),
        JWT_EXPIRES_IN: z.string().default('7d'),

        THROTTLE_TTL: z.coerce.number().int().positive().default(60),
        THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),

        // Trust proxy hop count (#65). 0 = dev (no proxy), 1 = single nginx,
        // 2 = CloudFront → nginx, etc. НЕ ставить `true`/`'*'` — это
        // позволит spoof через X-Forwarded-For от любого источника, throttle
        // обнулится. Default 0 для dev, в prod env обязательно 1+.
        TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),

        // Budget cap (#21) — daily $-cap для LLM cross-cutting calls.
        // Превышение → 503 ServiceUnavailable. Reset на UTC midnight.
        // Vision $5/день ≈ 700 single-image searches (или 140 multi-5).
        // Embedding $1/день ≈ 50M tokens (фактически unlimited для нашего
        // масштаба — cap для симметрии и future-proofing).
        VISION_BUDGET_DAILY_USD: z.coerce.number().positive().default(5),
        EMBEDDING_BUDGET_DAILY_USD: z.coerce.number().positive().default(1),

        // Telegram alerts (#36) — уведомление админу при первом превышении
        // budget-cap в день. Дев-бот общий с CRM (AquaphorBot_bot), prod-бот
        // отдельный (см. CLAUDE.md). Без креденшелов фича отключена тихо
        // (BudgetService.notifyExhausted no-op'ит).
        TELEGRAM_BOT_TOKEN: z.string().optional().default(''),
        // Список Telegram user_id через `__`. Пустой = алерты отправлять некому.
        TELEGRAM_ALERT_CHAT_IDS: z.string().optional().default(''),
        // Master switch — false для dev (тесты не спамят), true для prod.
        TELEGRAM_ALERTS_ENABLED: booleanFromString.default(false),
    })
    .superRefine((env, ctx) => {
        if (env.NODE_ENV !== 'production') {
            return;
        }
        const weakDefaults: Array<[keyof TAppEnv, string]> = [
            ['JWT_SECRET', 'change_me_in_production'],
            ['POSTGRES_PASSWORD', 'slovo_dev_password_change_me'],
            ['RABBITMQ_PASSWORD', 'slovo_dev_password_change_me'],
            ['LANGFUSE_POSTGRES_PASSWORD', 'langfuse_dev_password_change_me'],
            ['MINIO_ROOT_PASSWORD', 'slovo_dev_minio_password_change_me'],
            ['MINIO_ROOT_USER', 'minioadmin'],
            ['S3_SECRET_KEY', 'slovo_dev_minio_password_change_me'],
            ['S3_ACCESS_KEY', 'minioadmin'],
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
        // Если slovo runtime в production ходит в Flowise (FLOWISE_API_URL set) —
        // FLOWISE_API_KEY обязателен. Без него Flowise REST вернёт 401 на
        // RBAC-protected endpoint'ах (всё кроме /ping и public predictions).
        if (env.FLOWISE_API_URL && !env.FLOWISE_API_KEY) {
            ctx.addIssue({
                code: 'custom',
                path: ['FLOWISE_API_KEY'],
                message:
                    'FLOWISE_API_KEY обязателен в production когда FLOWISE_API_URL задан — создай ключ в Flowise UI → API Keys',
            });
        }
        // Cache-poisoning защита (#66). Vision-cache хранит JSON ответы Vision
        // под публично-видимыми SHA256-ключами; без пароля в Redis злоумышленник
        // с network access мог бы записать фейковый descriptionRu в кеш →
        // клиент получит мусор в embedding-search. Минимум 16 символов.
        if (env.REDIS_PASSWORD.length < 16) {
            ctx.addIssue({
                code: 'custom',
                path: ['REDIS_PASSWORD'],
                message: 'REDIS_PASSWORD обязателен в production (минимум 16 символов) — защита cache-poisoning',
            });
        }
        // Trust proxy hops — без явного значения в production все запросы
        // получат IP nginx'а, IPv6-/64 throttle (#65) обнулится, abuse-
        // protection не работает. Если deploy без прокси — выставить 0
        // явно (env-var) чтобы прошёл этот guard.
        if (env.TRUSTED_PROXY_HOPS === 0) {
            ctx.addIssue({
                code: 'custom',
                path: ['TRUSTED_PROXY_HOPS'],
                message:
                    'TRUSTED_PROXY_HOPS должен быть явно задан в production (1 для nginx, 2 для CF→nginx, 0 если без прокси)',
            });
        }
    });

export type TAppEnv = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): TAppEnv {
    const result = envSchema.safeParse(config);
    if (!result.success) {
        const lines = result.error.issues
            .map((issue) => `  - ${issue.path.join('.') || '<root>'}: ${issue.message}`)
            .join('\n');
        throw new Error(`Invalid environment configuration:\n${lines}`);
    }
    return result.data;
}
