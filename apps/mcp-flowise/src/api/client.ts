import { getConfig, type TFlowiseConfig } from '../config';
import { FlowiseError } from '../utils/errors';

type TRequestOptions = {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined>;
};

const RETRY_BASE_DELAY_MS = 500;

export class FlowiseClient {
    private readonly config: TFlowiseConfig;
    private lastRequestAt = 0;

    constructor(config?: TFlowiseConfig) {
        this.config = config ?? getConfig();
    }

    async request<T>(path: string, options: TRequestOptions = {}): Promise<T> {
        const { method = 'GET', body, query } = options;

        await this.throttle();

        const url = this.buildUrl(path, query);
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= this.config.FLOWISE_MAX_RETRIES; attempt += 1) {
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
                    if (attempt < this.config.FLOWISE_MAX_RETRIES) {
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
                if (attempt < this.config.FLOWISE_MAX_RETRIES) {
                    await sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
                }
            }
        }

        throw new FlowiseError(lastError?.message ?? 'Failed after retries');
    }

    private async fetchWithTimeout(url: string, method: string, body: unknown): Promise<Response> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.FLOWISE_REQUEST_TIMEOUT_MS);
        try {
            return await fetch(url, {
                method,
                headers: {
                    Authorization: `Bearer ${this.config.FLOWISE_API_KEY}`,
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
        if (this.config.FLOWISE_THROTTLE_MS === 0) {
            return;
        }
        const now = Date.now();
        const elapsed = now - this.lastRequestAt;
        if (elapsed < this.config.FLOWISE_THROTTLE_MS) {
            await sleep(this.config.FLOWISE_THROTTLE_MS - elapsed);
        }
        this.lastRequestAt = Date.now();
    }

    private buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>): string {
        const base = this.config.FLOWISE_API_URL.replace(/\/+$/, '');
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

let clientInstance: FlowiseClient | null = null;

export function getFlowiseClient(): FlowiseClient {
    if (!clientInstance) {
        clientInstance = new FlowiseClient();
    }
    return clientInstance;
}

export function resetClientForTests(): void {
    clientInstance = null;
}
