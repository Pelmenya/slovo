import { setupFetchMock } from '../__test-helpers__/setup-fetch';
import {
    chatflowCloneHandler,
    docstoreCloneHandler,
    docstoreFullSetupHandler,
} from './composite';

const SAMPLE_CHATFLOW = {
    id: 'cf-source',
    name: 'Source Flow',
    flowData: '{"nodes":[{"id":"n1"}],"edges":[]}',
    type: 'CHATFLOW' as const,
    deployed: true,
    isPublic: false,
    category: 'demo',
    chatbotConfig: '{"theme":"dark"}',
    apiConfig: null,
    speechToText: null,
    followUpPrompts: null,
    apikeyid: 'k1',
    createdDate: '2026-01-01T00:00:00Z',
    updatedDate: '2026-01-02T00:00:00Z',
};

const SAMPLE_DOCSTORE = {
    id: 'ds-source',
    name: 'Source Store',
    description: 'Original',
    status: 'UPSERTED',
    loaders: [],
    whereUsed: [],
    embeddingConfig: '{"name":"openAIEmbeddings","config":{"modelName":"text-embedding-3-small"}}',
    vectorStoreConfig: '{"name":"postgres","config":{"tableName":"src_chunks"}}',
    recordManagerConfig: null,
    totalChunks: 100,
    totalChars: 50000,
};

describe('composite tools', () => {
    const helpers = setupFetchMock();

    describe('chatflow_clone', () => {
        it('get → create с новым name', async () => {
            // GET source
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk(SAMPLE_CHATFLOW));
            // POST new
            helpers.fetchMock.mockResolvedValueOnce(
                helpers.mockOk({ ...SAMPLE_CHATFLOW, id: 'cf-new', name: 'Cloned' }),
            );
            const result = await chatflowCloneHandler({
                sourceChatflowId: 'cf-source',
                name: 'Cloned',
            });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.id).toBe('cf-new');
                expect(result.data.name).toBe('Cloned');
            }
            // 2 запроса — get + create
            expect(helpers.fetchMock).toHaveBeenCalledTimes(2);
        });

        it('failure GET → fail без POST', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockErr(404, { message: 'Not found' }));
            const result = await chatflowCloneHandler({
                sourceChatflowId: 'missing',
                name: 'X',
            });
            expect(result.success).toBe(false);
            expect(helpers.fetchMock).toHaveBeenCalledTimes(1);
        });

        it('transformFlowData → подменяет flowData в copy', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk(SAMPLE_CHATFLOW));
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk(SAMPLE_CHATFLOW));
            await chatflowCloneHandler({
                sourceChatflowId: 'cf-source',
                name: 'Cloned',
                transformFlowData: '{"nodes":[],"edges":[]}',
            });
            const [, createInit] = helpers.fetchMock.mock.calls[1] as [string, RequestInit];
            const createBody = JSON.parse(String(createInit.body)) as { flowData: string };
            expect(createBody.flowData).toBe('{"nodes":[],"edges":[]}');
        });
    });

    describe('docstore_clone', () => {
        it('get → create → vectorstore_save', async () => {
            // 1) get source
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk(SAMPLE_DOCSTORE));
            // 2) create
            helpers.fetchMock.mockResolvedValueOnce(
                helpers.mockOk({ ...SAMPLE_DOCSTORE, id: 'ds-new', name: 'Cloned Store' }),
            );
            // 3) vectorstore_save
            helpers.fetchMock.mockResolvedValueOnce(
                helpers.mockOk({ ...SAMPLE_DOCSTORE, id: 'ds-new' }),
            );
            const result = await docstoreCloneHandler({
                sourceStoreId: 'ds-source',
                name: 'Cloned Store',
            });
            expect(result.success).toBe(true);
            expect(helpers.fetchMock).toHaveBeenCalledTimes(3);
        });

        it('source без embedding/vectorstore configs → только create без save', async () => {
            const minimal = { ...SAMPLE_DOCSTORE, embeddingConfig: null, vectorStoreConfig: null };
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk(minimal));
            helpers.fetchMock.mockResolvedValueOnce(
                helpers.mockOk({ ...minimal, id: 'ds-new', name: 'Cloned' }),
            );
            const result = await docstoreCloneHandler({
                sourceStoreId: 'ds-source',
                name: 'Cloned',
            });
            expect(result.success).toBe(true);
            expect(helpers.fetchMock).toHaveBeenCalledTimes(2); // только get + create, save пропущен
        });
    });

    describe('docstore_full_setup', () => {
        it('5-step flow: create → loader_save → loader_process → vectorstore_insert', async () => {
            helpers.fetchMock
                // 1) create store
                .mockResolvedValueOnce(helpers.mockOk({ ...SAMPLE_DOCSTORE, id: 'ds-new', name: 'Full Setup' }))
                // 2) loader_save
                .mockResolvedValueOnce(helpers.mockOk({ id: 'l1', loaderId: 'S3', loaderName: 'S3', totalChunks: 0, totalChars: 0, status: 'SYNCING' }))
                // 3) loader_process
                .mockResolvedValueOnce(helpers.mockOk({ chunks: [], count: 100, file: { id: 'l1', loaderId: 'S3', loaderName: 'S3', totalChunks: 100, totalChars: 5000, status: 'SYNC' } }))
                // 4) vectorstore_insert (which calls vectorstore_save under the hood server-side)
                .mockResolvedValueOnce(helpers.mockOk({ inserted: 100 }));

            const result = await docstoreFullSetupHandler({
                name: 'Full Setup',
                loaderId: 'S3',
                loaderName: 'S3',
                loaderConfig: { bucketName: 'b1', keyName: 'data.json' },
                embeddingName: 'openAIEmbeddings',
                embeddingConfig: { modelName: 'text-embedding-3-small' },
                vectorStoreName: 'postgres',
                vectorStoreConfig: { tableName: 'chunks' },
            });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.storeId).toBe('ds-new');
                expect(result.data.loaderId).toBe('l1');
                expect(result.data.chunksCount).toBe(100);
            }
            expect(helpers.fetchMock).toHaveBeenCalledTimes(4);
        });

        it('failure на loader_save → fail без следующих шагов', async () => {
            helpers.fetchMock
                .mockResolvedValueOnce(helpers.mockOk({ ...SAMPLE_DOCSTORE, id: 'ds-new' }))
                .mockResolvedValueOnce(helpers.mockErr(400, { message: 'Invalid loader' }));
            const result = await docstoreFullSetupHandler({
                name: 'Full Setup',
                loaderId: 'S3',
                loaderName: 'S3',
                loaderConfig: {},
                embeddingName: 'openAIEmbeddings',
                embeddingConfig: {},
                vectorStoreName: 'postgres',
                vectorStoreConfig: {},
            });
            expect(result.success).toBe(false);
            expect(helpers.fetchMock).toHaveBeenCalledTimes(2);
        });
    });
});
