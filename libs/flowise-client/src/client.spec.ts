import { FlowiseClient } from './client';
import { FlowiseError } from './errors';
import type { TFlowiseClientConfig } from './t-config';

const baseConfig: TFlowiseClientConfig = {
    apiUrl: 'http://flowise.test',
    apiKey: 'secret-key',
    requestTimeoutMs: 1000,
    throttleMs: 0,
    maxRetries: 2,
};

describe('FlowiseClient', () => {
    const fetchMock = jest.fn();
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        fetchMock.mockReset();
        (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
    });

    afterAll(() => {
        (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
    });

    function mockResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
        const text = typeof body === 'string' ? body : JSON.stringify(body);
        return {
            ok: status >= 200 && status < 300,
            status,
            headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
            text: async () => text,
        } as unknown as Response;
    }

    it('GET — отправляет bearer и парсит JSON', async () => {
        fetchMock.mockResolvedValueOnce(mockResponse(200, { ok: true }));
        const client = new FlowiseClient(baseConfig);
        const result = await client.request<{ ok: boolean }>('/api/v1/ping');

        expect(result.ok).toBe(true);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('http://flowise.test/api/v1/ping');
        expect(init.method).toBe('GET');
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-key');
    });

    it('POST — сериализует body', async () => {
        fetchMock.mockResolvedValueOnce(mockResponse(200, { count: 4 }));
        const client = new FlowiseClient(baseConfig);
        await client.request('/x', { method: 'POST', body: { storeId: 's1' } });

        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(init.method).toBe('POST');
        expect(init.body).toBe(JSON.stringify({ storeId: 's1' }));
    });

    it('query-параметры собираются в URL', async () => {
        fetchMock.mockResolvedValueOnce(mockResponse(200, []));
        const client = new FlowiseClient(baseConfig);
        await client.request('/list', { query: { page: 1, search: 'foo', skip: undefined } });

        const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('http://flowise.test/list?page=1&search=foo');
    });

    it('429 — ретраит и получает успех', async () => {
        fetchMock
            .mockResolvedValueOnce(mockResponse(429, '', { 'retry-after': '0' }))
            .mockResolvedValueOnce(mockResponse(200, { ok: true }));
        const client = new FlowiseClient(baseConfig);
        const result = await client.request<{ ok: boolean }>('/x');
        expect(result.ok).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('non-ok ответ — кидает FlowiseError с messsage из payload', async () => {
        fetchMock.mockResolvedValueOnce(mockResponse(404, { message: 'Not found' }));
        const client = new FlowiseClient(baseConfig);
        await expect(client.request('/x')).rejects.toMatchObject({
            name: 'FlowiseError',
            statusCode: 404,
            message: 'Not found',
        });
    });

    it('FlowiseError не ретраится', async () => {
        fetchMock.mockResolvedValueOnce(mockResponse(401, { message: 'Unauthorized' }));
        const client = new FlowiseClient(baseConfig);
        await expect(client.request('/x')).rejects.toBeInstanceOf(FlowiseError);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('persistent 429 — кидает FlowiseError(429) вместо generic после исчерпания', async () => {
        const persistentConfig: TFlowiseClientConfig = { ...baseConfig, maxRetries: 1 };
        fetchMock
            .mockResolvedValueOnce(mockResponse(429, '', { 'retry-after': '0' }))
            .mockResolvedValueOnce(mockResponse(429, '', { 'retry-after': '0' }));
        const client = new FlowiseClient(persistentConfig);
        await expect(client.request('/x')).rejects.toMatchObject({
            name: 'FlowiseError',
            statusCode: 429,
            message: expect.stringContaining('Rate limited'),
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('минимальный config (без override-ов) — конструктор не падает', () => {
        const minimal = new FlowiseClient({ apiUrl: 'http://x', apiKey: 'k' });
        expect(minimal).toBeInstanceOf(FlowiseClient);
    });
});
