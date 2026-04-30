import { credentialsListHandler } from './credentials';
import { resetClientForTests } from '../api/client';
import { resetConfigForTests } from '../config';

const SAMPLE = [
    { id: 'a', name: 'OpenAI', credentialName: 'openAIApi' },
    { id: 'b', name: 'minio-slovo', credentialName: 'awsApi' },
    { id: 'c', name: 'postgres', credentialName: 'PostgresApi' },
];

describe('flowise_credentials_list handler', () => {
    const fetchMock = jest.fn();
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        process.env.FLOWISE_API_KEY = 'k1';
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

    function mockOk(body: unknown): Response {
        return {
            ok: true,
            status: 200,
            headers: { get: () => null },
            text: async () => JSON.stringify(body),
        } as unknown as Response;
    }

    it('возвращает все credentials без фильтра', async () => {
        fetchMock.mockResolvedValueOnce(mockOk(SAMPLE));
        const result = await credentialsListHandler({});
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.count).toBe(3);
            expect(result.data.credentials.map((c) => c.id)).toEqual(['a', 'b', 'c']);
        }
    });

    it('фильтрует по credentialName', async () => {
        fetchMock.mockResolvedValueOnce(mockOk(SAMPLE));
        const result = await credentialsListHandler({ credentialName: 'awsApi' });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.count).toBe(1);
            expect(result.data.credentials[0]?.id).toBe('b');
        }
    });

    it('Unauthorized из Flowise → success=false', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 401,
            headers: { get: () => null },
            text: async () => JSON.stringify({ message: 'Unauthorized Access' }),
        } as unknown as Response);

        const result = await credentialsListHandler({});
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error).toContain('Unauthorized');
            expect(result.error).toContain('401');
        }
    });
});
