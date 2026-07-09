"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlowiseClient = void 0;
const t_config_1 = require("./t-config");
const errors_1 = require("./errors");
const RETRY_BASE_DELAY_MS = 500;
// =============================================================================
// FlowiseClient — тонкий REST-клиент с bearer auth, retry на 429, throttle,
// timeout. Не зависит от env / dotenv / NestJS — config передаётся в конструктор.
// =============================================================================
class FlowiseClient {
    apiUrl;
    apiKey;
    requestTimeoutMs;
    throttleMs;
    maxRetries;
    lastRequestAt = 0;
    constructor(config) {
        this.apiUrl = config.apiUrl;
        this.apiKey = config.apiKey;
        this.requestTimeoutMs = config.requestTimeoutMs ?? t_config_1.DEFAULT_REQUEST_TIMEOUT_MS;
        this.throttleMs = config.throttleMs ?? t_config_1.DEFAULT_THROTTLE_MS;
        this.maxRetries = config.maxRetries ?? t_config_1.DEFAULT_MAX_RETRIES;
    }
    async request(path, options = {}) {
        const { method = 'GET', body, query } = options;
        await this.throttle();
        const url = this.buildUrl(path, query);
        let lastError = null;
        for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
            try {
                const response = await this.fetchWithTimeout(url, method, body);
                if (response.status === 429) {
                    const retryAfter = response.headers.get('Retry-After');
                    const delayMs = retryAfter
                        ? Number.parseInt(retryAfter, 10) * 1000
                        : RETRY_BASE_DELAY_MS * (attempt + 1);
                    lastError = new errors_1.FlowiseError(`Rate limited (HTTP 429), retry-after=${retryAfter ?? 'n/a'}`, 429);
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
                    throw new errors_1.FlowiseError(message, response.status, parsed);
                }
                return parsed;
            }
            catch (error) {
                if (error instanceof errors_1.FlowiseError) {
                    throw error;
                }
                lastError = error instanceof Error ? error : new Error(String(error));
                if (attempt < this.maxRetries) {
                    await sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
                }
            }
        }
        throw new errors_1.FlowiseError(lastError?.message ?? 'Failed after retries');
    }
    async fetchWithTimeout(url, method, body) {
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
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async throttle() {
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
    buildUrl(path, query) {
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
exports.FlowiseClient = FlowiseClient;
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function parseJsonSafe(text) {
    if (!text) {
        return undefined;
    }
    try {
        return JSON.parse(text);
    }
    catch {
        return text;
    }
}
function extractErrorMessage(payload) {
    if (typeof payload === 'string' && payload.trim().length > 0) {
        return payload;
    }
    if (payload && typeof payload === 'object') {
        const record = payload;
        if (typeof record.message === 'string') {
            return record.message;
        }
        if (typeof record.error === 'string') {
            return record.error;
        }
    }
    return null;
}
//# sourceMappingURL=client.js.map