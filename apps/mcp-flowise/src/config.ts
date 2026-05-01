import { z } from 'zod';
import { FlowiseClient, type TFlowiseClientConfig } from '@slovo/flowise-client';

// =============================================================================
// MCP-server-specific config: читает env (process.env), валидирует через zod,
// конструирует TFlowiseClientConfig и singleton FlowiseClient из libs/flowise-client.
// Lib сама не знает про env — это ответственность apps-слоя.
// =============================================================================

const configSchema = z.object({
    FLOWISE_API_URL: z.url().default('http://127.0.0.1:3130'),
    FLOWISE_API_KEY: z.string().min(1, 'FLOWISE_API_KEY обязателен — создай в Flowise UI → API Keys'),
    FLOWISE_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
    FLOWISE_THROTTLE_MS: z.coerce.number().int().min(0).default(50),
    FLOWISE_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(3),
});

export type TFlowiseConfig = z.infer<typeof configSchema>;

let cached: TFlowiseConfig | null = null;
let clientInstance: FlowiseClient | null = null;

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

export function getFlowiseClient(): FlowiseClient {
    if (!clientInstance) {
        const config = getConfig();
        const clientConfig: TFlowiseClientConfig = {
            apiUrl: config.FLOWISE_API_URL,
            apiKey: config.FLOWISE_API_KEY,
            requestTimeoutMs: config.FLOWISE_REQUEST_TIMEOUT_MS,
            throttleMs: config.FLOWISE_THROTTLE_MS,
            maxRetries: config.FLOWISE_MAX_RETRIES,
        };
        clientInstance = new FlowiseClient(clientConfig);
    }
    return clientInstance;
}

export function resetConfigForTests(): void {
    cached = null;
    clientInstance = null;
}
