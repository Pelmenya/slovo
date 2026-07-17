import { z } from 'zod';

/**
 * Env-контур голосового приложения — СВОЙ, отдельный от slovo-core (@slovo/common).
 * Голос не требует RABBITMQ/S3/JWT, а slovo-core не знает про ARI/SIP/SpeechKit.
 * Изоляция контуров: apps/voice поднимается со своим набором переменных.
 *
 * Секреты клиник в БД НЕ храним — тенант ссылается на env-неймспейс (Clinic.envNamespace);
 * фактические SIP-креды приходят из env по этому неймспейсу. Врачебная тайна: минимум в БД.
 */
export const voiceEnvSchema = z.object({
    // Postgres (общий с slovo)
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\/.+/),

    // Yandex AI Studio — речь и LLM (два узких ключа, разные scope)
    YANDEX_API_KEY: z.string().min(1),
    YANDEX_LLM_API_KEY: z.string().min(1),
    YANDEX_FOLDER_ID: z.string().min(1),
    LLM_CLASSIFIER_MODEL: z.string().optional(),

    // ARI (локальный Asterisk)
    ARI_URL: z.string().url().default('http://localhost:8088'),
    ARI_USER: z.string().min(1),
    ARI_PASSWORD: z.string().min(1),
    ARI_APP: z.string().default('slovo-voice'),

    // SIP-транк (дефолтный тенант спайка; прод — по Clinic.envNamespace)
    SIP_CALLER_ID: z.string().min(1),

    // Медиа (bind-mount в docker-compose.voice.yml)
    MEDIA_SOUNDS_DIR: z.string().default('./media/sounds'),
    MEDIA_RECORDINGS_DIR: z.string().default('./media/recordings'),

    // Прокси в окружении Димы ломает локальный ARI — держим localhost вне прокси
    NO_PROXY: z.string().optional(),
});

export type TVoiceEnv = z.infer<typeof voiceEnvSchema>;

export function validateVoiceEnv(config: Record<string, unknown>): TVoiceEnv {
    const result = voiceEnvSchema.safeParse(config);
    if (!result.success) {
        const lines = result.error.issues
            .map((issue) => `  - ${issue.path.join('.') || '<root>'}: ${issue.message}`)
            .join('\n');
        throw new Error(`Invalid voice environment configuration:\n${lines}`);
    }
    return result.data;
}
