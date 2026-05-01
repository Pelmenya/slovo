import {
    DEFAULT_MAX_RETRIES,
    DEFAULT_REQUEST_TIMEOUT_MS,
    DEFAULT_THROTTLE_MS,
    type TFlowiseClientConfig,
} from './t-config';
import { FlowiseError } from './errors';

type TRequestOptions = {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined>;
};

const RETRY_BASE_DELAY_MS = 500;

// =============================================================================
// FlowiseClient — тонкий REST-клиент с bearer auth, retry на 429, throttle,
// timeout. Не зависит от env / dotenv / NestJS — config передаётся в конструктор.
// =============================================================================

export class FlowiseClient {
    private readonly apiUrl: string;
    private readonly apiKey: string;
    private readonly requestTimeoutMs: number;
    private readonly throttleMs: number;
    private readonly maxRetries: number;
    private lastRequestAt = 0;

    constructor(config: TFlowiseClientConfig) {
        this.apiUrl = config.apiUrl;
        this.apiKey = config.apiKey;
        this.requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
        this.throttleMs = config.throttleMs ?? DEFAULT_THROTTLE_MS;
        this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    }

    async request<T>(path: string, options: TRequestOptions = {}): Promise<T> {
        const { method = 'GET', body, query } = options;

        await this.throttle();

        const url = this.buildUrl(path, query);
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
            try {
                const response = await this.fetchWithTimeout(url, method, body);

                if (response.status === 429) {
                    const retryAfter = response.headers.get('Retry-After');
                    const delayMs = retryAfter
                        ? Number.parseInt(retryAfter, 10) * 1000
                        : RETRY_BASE_DELAY_MS * (attempt + 1);
                    lastError = new FlowiseError(
                        `Rate limited (HTTP 429), retry-after=${retryAfter ?? 'n/a'}`,
                        429,
                    );
                    if (attempt < this.maxRetries) {
                        await sleep(delayMs);
                        continue;
                    }
                    throw lastError;
                }

                const text = await response.text();
                const parsed = parseJsonSafe(text);

                if (!response.ok) {
                    const message = extractErrorMessage(parsed) ?? `Flowise responded ${response.status}`;
                    throw new FlowiseError(message, response.status, parsed);
                }

                return parsed as T;
            } catch (error) {
                if (error instanceof FlowiseError) {
                    throw error;
                }
                lastError = error instanceof Error ? error : new Error(String(error));
                if (attempt < this.maxRetries) {
                    await sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
                }
            }
        }

        throw new FlowiseError(lastError?.message ?? 'Failed after retries');
    }

    private async fetchWithTimeout(url: string, method: string, body: unknown): Promise<Response> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
        try {
            return await fetch(url, {
                method,
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                body: body !== undefined ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timeout);
        }
    }

    private async throttle(): Promise<void> {
        if (this.throttleMs === 0) {
            return;
        }
        const now = Date.now();
        const elapsed = now - this.lastRequestAt;
        if (elapsed < this.throttleMs) {
            await sleep(this.throttleMs - elapsed);
        }
        this.lastRequestAt = Date.now();
    }

    private buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>): string {
        const base = this.apiUrl.replace(/\/+$/, '');
        const url = new URL(`${base}${path}`);
        if (query) {
            for (const [key, value] of Object.entries(query)) {
                if (value !== undefined) {
                    url.searchParams.set(key, String(value));
                }
            }
        }
        return url.toString();
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJsonSafe(text: string): unknown {
    if (!text) {
        return undefined;
    }
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return text;
    }
}

function extractErrorMessage(payload: unknown): string | null {
    if (typeof payload === 'string' && payload.trim().length > 0) {
        return payload;
    }
    if (payload && typeof payload === 'object') {
        const record = payload as Record<string, unknown>;
        if (typeof record.message === 'string') {
            return record.message;
        }
        if (typeof record.error === 'string') {
            return record.error;
        }
    }
    return null;
}
