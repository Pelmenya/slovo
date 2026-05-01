// =============================================================================
// Конфиг FlowiseClient — передаётся в конструктор. Apps (mcp-flowise / worker /
// api) сами валидируют env и собирают TFlowiseClientConfig из своих source'ов.
// Lib не знает про process.env / dotenv / NestJS ConfigService — direction
// зависимостей чистый (apps → libs).
// =============================================================================

export type TFlowiseClientConfig = {
    apiUrl: string;
    apiKey: string;
    requestTimeoutMs?: number;
    throttleMs?: number;
    maxRetries?: number;
};

export const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
export const DEFAULT_THROTTLE_MS = 50;
export const DEFAULT_MAX_RETRIES = 3;
