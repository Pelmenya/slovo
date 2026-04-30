import { z } from 'zod';

const configSchema = z.object({
    FLOWISE_API_URL: z.url().default('http://127.0.0.1:3130'),
    FLOWISE_API_KEY: z.string().min(1, 'FLOWISE_API_KEY обязателен — создай в Flowise UI → API Keys'),
    FLOWISE_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
    FLOWISE_THROTTLE_MS: z.coerce.number().int().min(0).default(50),
    FLOWISE_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(3),
});

export type TFlowiseConfig = z.infer<typeof configSchema>;

let cached: TFlowiseConfig | null = null;

export function getConfig(): TFlowiseConfig {
    if (cached) {
        return cached;
    }
    const result = configSchema.safeParse(process.env);
    if (!result.success) {
        const lines = result.error.issues
            .map((issue) => `  - ${issue.path.join('.') || '<root>'}: ${issue.message}`)
            .join('\n');
        throw new Error(`Invalid mcp-flowise environment:\n${lines}`);
    }
    cached = result.data;
    return cached;
}

export function resetConfigForTests(): void {
    cached = null;
}
