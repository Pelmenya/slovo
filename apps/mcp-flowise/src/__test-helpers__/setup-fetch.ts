import { resetClientForTests } from '../api/client';
import { resetConfigForTests } from '../config';

export type TFetchMock = jest.Mock<Promise<Response>, Parameters<typeof fetch>>;

export type TSetupFetchMock = {
    fetchMock: TFetchMock;
    mockOk: (body: unknown, headers?: Record<string, string>) => Response;
    mockErr: (status: number, body: unknown, headers?: Record<string, string>) => Response;
};

/**
 * Универсальный setup для tool-spec'ов: env, reset singletons, mock global fetch.
 * Вызывать в beforeEach. Возвращает { fetchMock, mockOk, mockErr }.
 *
 * @example
 * describe('flowise_xxx handler', () => {
 *   const helpers = setupFetchMock();
 *   it('happy path', async () => {
 *     helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk({ ok: true }));
 *     const result = await xxxHandler({});
 *     expect(result.success).toBe(true);
 *   });
 * });
 */
export function setupFetchMock(): TSetupFetchMock {
    const fetchMock = jest.fn() as TFetchMock;
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        process.env.FLOWISE_API_KEY = 'test-key';
        process.env.FLOWISE_API_URL = 'http://flowise.test';
        process.env.FLOWISE_THROTTLE_MS = '0';
        resetConfigForTests();
        resetClientForTests();
        fetchMock.mockReset();
        (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
    });

    afterAll(() => {
        (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
    });

    function mockResponse(status: number, body: unknown, headers: Record<string, string>): Response {
        const text = typeof body === 'string' ? body : JSON.stringify(body);
        return {
            ok: status >= 200 && status < 300,
            status,
            headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
            text: async () => text,
        } as unknown as Response;
    }

    return {
        fetchMock,
        mockOk: (body, headers = {}) => mockResponse(200, body, headers),
        mockErr: (status, body, headers = {}) => mockResponse(status, body, headers),
    };
}
