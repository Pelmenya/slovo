import { docstoreListHandler, docstoreQueryHandler } from './docstore';
import { resetClientForTests } from '../api/client';
import { resetConfigForTests } from '../config';

describe('flowise_docstore_* handlers', () => {
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

    describe('flowise_docstore_list', () => {
        it('сводка по каждому store без раскрытия loader-ов', async () => {
            fetchMock.mockResolvedValueOnce(
                mockOk([
                    {
                        id: 'aec',
                        name: 'catalog-aquaphor',
                        description: 'Каталог',
                        status: 'UPSERTED',
                        loaders: [{ id: 'l1' }],
                        whereUsed: [],
                        vectorStoreConfig: '{...}',
                        embeddingConfig: '{...}',
                        recordManagerConfig: null,
                        totalChunks: 912,
                        totalChars: 772232,
                    },
                ]),
            );
            const result = await docstoreListHandler({});
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.count).toBe(1);
                const store = result.data.stores[0];
                expect(store?.id).toBe('aec');
                expect(store?.totalChunks).toBe(912);
                expect(store?.loadersCount).toBe(1);
                expect(store?.hasEmbedding).toBe(true);
                expect(store?.hasVectorStore).toBe(true);
            }
        });

        it('пустой список — count=0', async () => {
            fetchMock.mockResolvedValueOnce(mockOk([]));
            const result = await docstoreListHandler({});
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.count).toBe(0);
                expect(result.data.stores).toEqual([]);
            }
        });
    });

    describe('flowise_docstore_query', () => {
        it('возвращает docs с timeTaken и count', async () => {
            fetchMock.mockResolvedValueOnce(
                mockOk({
                    timeTaken: 525,
                    docs: [
                        { id: 'd1', pageContent: 'item-1', metadata: { externalId: 'X' } },
                        { id: 'd2', pageContent: 'item-2', metadata: {} },
                    ],
                }),
            );
            const result = await docstoreQueryHandler({ storeId: 's1', query: 'смеситель' });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.timeTaken).toBe(525);
                expect(result.data.count).toBe(2);
                expect(result.data.docs[0]?.id).toBe('d1');
            }
        });

        it('передаёт topK в payload если задан', async () => {
            fetchMock.mockResolvedValueOnce(mockOk({ timeTaken: 100, docs: [] }));
            await docstoreQueryHandler({ storeId: 's1', query: 'x', topK: 10 });
            const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
            const body = JSON.parse(String(init.body)) as Record<string, unknown>;
            expect(body.topK).toBe(10);
        });

        it('storeId не найден → error', async () => {
            fetchMock.mockResolvedValueOnce({
                ok: false,
                status: 404,
                headers: { get: () => null },
                text: async () => JSON.stringify({ message: 'Document store not found' }),
            } as unknown as Response);

            const result = await docstoreQueryHandler({ storeId: 'missing', query: 'x' });
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error).toContain('not found');
                expect(result.error).toContain('404');
            }
        });
    });
});
