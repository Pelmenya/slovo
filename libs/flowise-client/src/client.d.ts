import { type TFlowiseClientConfig } from './t-config';
export type TRequestOptions = {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined>;
};
export declare class FlowiseClient {
    private readonly apiUrl;
    private readonly apiKey;
    private readonly requestTimeoutMs;
    private readonly throttleMs;
    private readonly maxRetries;
    private lastRequestAt;
    constructor(config: TFlowiseClientConfig);
    request<T>(path: string, options?: TRequestOptions): Promise<T>;
    private fetchWithTimeout;
    private throttle;
    private buildUrl;
}
//# sourceMappingURL=client.d.ts.map