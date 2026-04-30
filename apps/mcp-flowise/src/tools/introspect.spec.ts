import { setupFetchMock } from '../__test-helpers__/setup-fetch';
import {
    docstoreSearchByNameHandler,
    introspectHandler,
    smokeHandler,
} from './introspect';

describe('introspect / smoke / docstore_search_by_name', () => {
    const helpers = setupFetchMock();

    describe('introspect', () => {
        it('aggregates 6 calls: ping + chatflows + agentflows + docstores + credentials + nodes', async () => {
            helpers.fetchMock
                .mockResolvedValueOnce(helpers.mockOk('pong')) // ping
                .mockResolvedValueOnce(helpers.mockOk([{ id: 'c1', type: 'CHATFLOW' }])) // chatflows
                .mockResolvedValueOnce(helpers.mockOk([])) // agentflows (empty)
                .mockResolvedValueOnce(helpers.mockOk([
                    { id: 'd1', name: 's', loaders: [], whereUsed: [], totalChunks: 0, totalChars: 0, status: 'EMPTY' },
                ])) // docstores
                .mockResolvedValueOnce(helpers.mockOk([{ id: 'cr1', name: 'X', credentialName: 'awsApi' }])) // credentials
                .mockResolvedValueOnce(helpers.mockOk([{ name: 'n1', label: 'N', category: 'X', version: 1, type: 'X', baseClasses: [] }])); // nodes

            const result = await introspectHandler({});
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.health.ok).toBe(true);
                expect(result.data.counts.chatflows).toBe(1);
                expect(result.data.counts.agentflows).toBe(0);
                expect(result.data.counts.documentStores).toBe(1);
                expect(result.data.counts.credentials).toBe(1);
                expect(result.data.counts.nodes).toBe(1);
                expect(result.data.failures).toEqual([]);
            }
            expect(helpers.fetchMock).toHaveBeenCalledTimes(6);
        });

        it('частичные failures собираются в failures[]', async () => {
            helpers.fetchMock
                .mockResolvedValueOnce(helpers.mockOk('pong'))
                .mockResolvedValueOnce(helpers.mockErr(500, { message: 'chatflows failed' }))
                .mockResolvedValueOnce(helpers.mockOk([]))
                .mockResolvedValueOnce(helpers.mockOk([]))
                .mockResolvedValueOnce(helpers.mockOk([]))
                .mockResolvedValueOnce(helpers.mockOk([]));
            const result = await introspectHandler({});
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.failures).toHaveLength(1);
                expect(result.data.failures[0]).toContain('chatflows');
                expect(result.data.counts.chatflows).toBe(-1);
            }
        });
    });

    describe('smoke', () => {
        it('5 шагов с per-step latency', async () => {
            helpers.fetchMock
                .mockResolvedValueOnce(helpers.mockOk('pong'))
                .mockResolvedValueOnce(helpers.mockOk([]))
                .mockResolvedValueOnce(helpers.mockOk([]))
                .mockResolvedValueOnce(helpers.mockOk([]))
                .mockResolvedValueOnce(helpers.mockOk([]));
            const result = await smokeHandler({});
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.steps).toHaveLength(5);
                expect(result.data.overallSuccess).toBe(true);
                result.data.steps.forEach((s) => {
                    expect(s.success).toBe(true);
                    expect(typeof s.elapsedMs).toBe('number');
                });
            }
        });

        it('overallSuccess=false если хоть один step упал', async () => {
            helpers.fetchMock
                .mockResolvedValueOnce(helpers.mockOk('pong'))
                .mockResolvedValueOnce(helpers.mockErr(500, 'oops'))
                .mockResolvedValueOnce(helpers.mockOk([]))
                .mockResolvedValueOnce(helpers.mockOk([]))
                .mockResolvedValueOnce(helpers.mockOk([]));
            const result = await smokeHandler({});
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.overallSuccess).toBe(false);
                expect(result.data.steps[1]?.success).toBe(false);
            }
        });
    });

    describe('docstore_search_by_name', () => {
        const SAMPLE_STORES = [
            { id: 'd1', name: 'catalog-aquaphor', loaders: [], whereUsed: [], totalChunks: 100, totalChars: 5000, status: 'UPSERTED' },
            { id: 'd2', name: 'catalog-marpla', loaders: [], whereUsed: [], totalChunks: 50, totalChars: 2000, status: 'UPSERTED' },
            { id: 'd3', name: 'knowledge-water', loaders: [], whereUsed: [], totalChunks: 200, totalChars: 10000, status: 'UPSERTED' },
        ];

        it('substring поиск (default)', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk(SAMPLE_STORES));
            const result = await docstoreSearchByNameHandler({ name: 'catalog' });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.count).toBe(2);
                expect(result.data.matches.map((m) => m.id)).toEqual(['d1', 'd2']);
            }
        });

        it('exactMatch=true — точное совпадение', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk(SAMPLE_STORES));
            const result = await docstoreSearchByNameHandler({
                name: 'catalog-aquaphor',
                exactMatch: true,
            });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.count).toBe(1);
                expect(result.data.matches[0]?.id).toBe('d1');
            }
        });

        it('case-insensitive', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk(SAMPLE_STORES));
            const result = await docstoreSearchByNameHandler({ name: 'AQUAPHOR' });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.count).toBe(1);
            }
        });

        it('failure из list propagated', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockErr(500, { message: 'Server' }));
            const result = await docstoreSearchByNameHandler({ name: 'X' });
            expect(result.success).toBe(false);
        });
    });
});
