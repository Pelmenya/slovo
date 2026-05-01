import { pingHandler } from './ping';
import { resetConfigForTests } from '../config';

describe('flowise_ping handler', () => {
    const fetchMock = jest.fn();
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        process.env.FLOWISE_API_KEY = 'k1';
        process.env.FLOWISE_API_URL = 'http://flowise.test';
        process.env.FLOWISE_THROTTLE_MS = '0';
        resetConfigForTests();
        fetchMock.mockReset();
        (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
    });

    afterAll(() => {
        (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
    });

    it('возвращает success с ok=true и elapsedMs', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: { get: () => null },
            text: async () => 'pong',
        } as unknown as Response);

        const result = await pingHandler({});
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.ok).toBe(true);
            expect(typeof result.data.elapsedMs).toBe('number');
            expect(result.data.elapsedMs).toBeGreaterThanOrEqual(0);
        }
    });

    it('сетевая ошибка → success=false с понятным error', async () => {
        fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

        const result = await pingHandler({});
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error).toContain('ECONNREFUSED');
        }
    });
});
