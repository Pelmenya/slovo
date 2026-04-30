import { setupFetchMock } from '../__test-helpers__/setup-fetch';
import {
    docstoreChunkDeleteHandler,
    docstoreChunksListHandler,
    docstoreChunkUpdateHandler,
    docstoreComponentsEmbeddingsHandler,
    docstoreComponentsLoadersHandler,
    docstoreComponentsRecordManagerHandler,
    docstoreComponentsVectorstoreHandler,
    docstoreCreateHandler,
    docstoreDeleteHandler,
    docstoreGetHandler,
    docstoreListHandler,
    docstoreLoaderDeleteHandler,
    docstoreLoaderPreviewHandler,
    docstoreLoaderProcessHandler,
    docstoreLoaderSaveHandler,
    docstoreQueryHandler,
    docstoreRefreshHandler,
    docstoreUpdateHandler,
    docstoreUpsertHandler,
    docstoreVectorstoreDeleteHandler,
    docstoreVectorstoreInsertHandler,
    docstoreVectorstoreSaveHandler,
    docstoreVectorstoreUpdateHandler,
} from './docstore';

const SAMPLE_STORE = {
    id: 'aec',
    name: 'catalog-aquaphor',
    description: 'Каталог',
    status: 'UPSERTED',
    loaders: [{ id: 'l1', loaderId: 'S3', loaderName: 'S3', totalChunks: 100, totalChars: 5000, status: 'SYNC' }],
    whereUsed: [],
    vectorStoreConfig: '{...}',
    embeddingConfig: '{...}',
    recordManagerConfig: null,
    totalChunks: 912,
    totalChars: 772232,
};

const SAMPLE_QUERY_RESP = {
    timeTaken: 525,
    docs: [
        { id: 'd1', pageContent: 'item-1', metadata: { externalId: 'X' }, chunkNo: 1 },
        { id: 'd2', pageContent: 'item-2', metadata: {} },
    ],
};

const SAMPLE_LOADER = {
    id: 'l1',
    loaderId: 'S3',
    loaderName: 'S3',
    splitterId: 'recursiveCharacterTextSplitter',
    totalChunks: 0,
    totalChars: 0,
    status: 'SYNCING',
};

const SAMPLE_NODE = {
    name: 's3',
    label: 'S3',
    version: 5,
    type: 'Document',
    category: 'Document Loaders',
    description: 'Load from S3',
    baseClasses: ['Document'],
    inputs: [{ name: 'bucketName', label: 'Bucket', type: 'string' }],
};

describe('docstore tools', () => {
    const helpers = setupFetchMock();

    describe('docstore_list', () => {
        it('сводка с loadersCount/hasEmbedding/hasVectorStore', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk([SAMPLE_STORE]));
            const result = await docstoreListHandler({});
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.count).toBe(1);
                const s = result.data.stores[0];
                expect(s?.loadersCount).toBe(1);
                expect(s?.hasEmbedding).toBe(true);
                expect(s?.hasVectorStore).toBe(true);
            }
        });

        it('пустой список', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk([]));
            const result = await docstoreListHandler({});
            expect(result.success).toBe(true);
            if (result.success) expect(result.data.count).toBe(0);
        });
    });

    describe('docstore_get', () => {
        it('детали по id', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk(SAMPLE_STORE));
            const result = await docstoreGetHandler({ storeId: 'aec' });
            expect(result.success).toBe(true);
            if (result.success) expect(result.data.id).toBe('aec');
        });

        it('404 → fail', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockErr(404, { message: 'Not found' }));
            const result = await docstoreGetHandler({ storeId: 'missing' });
            expect(result.success).toBe(false);
        });
    });

    describe('docstore_create / update / delete', () => {
        it('create — POST с name+description', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk(SAMPLE_STORE));
            await docstoreCreateHandler({ name: 'new-store', description: 'desc' });
            const [, init] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
            expect(init.method).toBe('POST');
            const body = JSON.parse(String(init.body)) as Record<string, unknown>;
            expect(body.name).toBe('new-store');
            expect(body.description).toBe('desc');
        });

        it('update — PUT без storeId в body', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk(SAMPLE_STORE));
            await docstoreUpdateHandler({ storeId: 'aec', name: 'Renamed' });
            const [url, init] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
            expect(url).toContain('/store/aec');
            const body = JSON.parse(String(init.body)) as Record<string, unknown>;
            expect(body.storeId).toBeUndefined();
            expect(body.name).toBe('Renamed');
        });

        it('delete → ok', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk({}));
            const result = await docstoreDeleteHandler({ storeId: 'aec' });
            expect(result.success).toBe(true);
            if (result.success) expect(result.data.ok).toBe(true);
        });
    });

    describe('docstore_upsert / refresh', () => {
        it('upsert — POST с docId/overrideConfig в body, без storeId', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk({ numAdded: 5 }));
            await docstoreUpsertHandler({
                storeId: 'aec',
                docId: 'l1',
                overrideConfig: { temperature: 0.5 },
            });
            const [url, init] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
            expect(url).toContain('/upsert/aec');
            expect(init.method).toBe('POST');
            const body = JSON.parse(String(init.body)) as Record<string, unknown>;
            expect(body.storeId).toBeUndefined();
            expect(body.docId).toBe('l1');
        });

        it('refresh — POST с пустым body', async () => {
            helpers.fetchMock.mockResolvedValueOnce(
                helpers.mockOk({ status: 'ok', processed: 100 }),
            );
            const result = await docstoreRefreshHandler({ storeId: 'aec' });
            expect(result.success).toBe(true);
            const [url, init] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
            expect(url).toContain('/refresh/aec');
            expect(init.method).toBe('POST');
            expect(init.body).toBe('{}');
        });
    });

    describe('docstore_loader_*', () => {
        it('save — POST с loaderConfig+splitterConfig', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk(SAMPLE_LOADER));
            await docstoreLoaderSaveHandler({
                storeId: 'aec',
                loaderId: 'S3',
                loaderName: 'S3',
                loaderConfig: { bucketName: 'b1' },
            });
            const [, init] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
            expect(init.method).toBe('POST');
            const body = JSON.parse(String(init.body)) as Record<string, unknown>;
            expect(body.loaderId).toBe('S3');
        });

        it('process — POST с rest body, без дублирующих storeId/loaderId через ...input', async () => {
            helpers.fetchMock.mockResolvedValueOnce(
                helpers.mockOk({ chunks: [], count: 0, file: SAMPLE_LOADER }),
            );
            await docstoreLoaderProcessHandler({ storeId: 'aec', loaderId: 'l1' });
            const [url, init] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
            expect(url).toContain('/process/l1');
            const body = JSON.parse(String(init.body)) as Record<string, unknown>;
            expect(body.storeId).toBe('aec');
            expect(body.id).toBe('l1');
        });

        it('preview — POST с loader+splitter', async () => {
            helpers.fetchMock.mockResolvedValueOnce(
                helpers.mockOk({ chunks: [], totalChunks: 0 }),
            );
            const result = await docstoreLoaderPreviewHandler({
                storeId: 'aec',
                loaderId: 'json',
                loaderName: 'Json File',
                loaderConfig: {},
            });
            expect(result.success).toBe(true);
        });

        it('delete loader — DELETE → ok', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk({}));
            const result = await docstoreLoaderDeleteHandler({ storeId: 'aec', loaderId: 'l1' });
            expect(result.success).toBe(true);
        });
    });

    describe('docstore_chunks_*', () => {
        it('chunks_list → пагинация', async () => {
            helpers.fetchMock.mockResolvedValueOnce(
                helpers.mockOk({ chunks: [], count: 0, currentPage: 1 }),
            );
            const result = await docstoreChunksListHandler({
                storeId: 'aec',
                fileId: 'l1',
                pageNo: 2,
            });
            expect(result.success).toBe(true);
            const [url] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
            expect(url).toContain('/chunks/aec/l1/2');
        });

        it('chunk_update — PUT с pageContent', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk({ chunks: [], count: 0 }));
            await docstoreChunkUpdateHandler({
                storeId: 'aec',
                loaderId: 'l1',
                chunkId: 'c1',
                pageContent: 'fixed text',
                metadata: { fixed: true },
            });
            const [, init] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
            expect(init.method).toBe('PUT');
            const body = JSON.parse(String(init.body)) as Record<string, unknown>;
            expect(body.pageContent).toBe('fixed text');
            expect(body.metadata).toEqual({ fixed: true });
        });

        it('chunk_delete → ok', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk({}));
            const result = await docstoreChunkDeleteHandler({
                storeId: 'aec',
                loaderId: 'l1',
                chunkId: 'c1',
            });
            expect(result.success).toBe(true);
        });
    });

    describe('docstore_query', () => {
        it('возвращает docs с timeTaken', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk(SAMPLE_QUERY_RESP));
            const result = await docstoreQueryHandler({ storeId: 'aec', query: 'смесители' });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.timeTaken).toBe(525);
                expect(result.data.count).toBe(2);
            }
        });

        it('topK прокидывается', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk({ timeTaken: 100, docs: [] }));
            await docstoreQueryHandler({ storeId: 'aec', query: 'q', topK: 10 });
            const [, init] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
            const body = JSON.parse(String(init.body)) as Record<string, unknown>;
            expect(body.topK).toBe(10);
        });

        it('404 → fail', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockErr(404, { message: 'Not found' }));
            const result = await docstoreQueryHandler({ storeId: 'missing', query: 'x' });
            expect(result.success).toBe(false);
        });
    });

    describe('docstore_vectorstore_*', () => {
        it('save — POST с embedding+vectorstore конфигами', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk(SAMPLE_STORE));
            await docstoreVectorstoreSaveHandler({
                storeId: 'aec',
                embeddingName: 'openAIEmbeddings',
                embeddingConfig: { modelName: 'text-embedding-3-small' },
            });
            const [, init] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
            expect(init.method).toBe('POST');
        });

        it('insert — POST на /vectorstore/insert', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk({ inserted: 100 }));
            await docstoreVectorstoreInsertHandler({ storeId: 'aec' });
            const [url] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
            expect(url).toContain('/vectorstore/insert');
        });

        it('update — POST на /vectorstore/update', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk(SAMPLE_STORE));
            await docstoreVectorstoreUpdateHandler({ storeId: 'aec' });
            const [url] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
            expect(url).toContain('/vectorstore/update');
        });

        it('delete → ok=true', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk({}));
            const result = await docstoreVectorstoreDeleteHandler({ storeId: 'aec' });
            expect(result.success).toBe(true);
            const [url, init] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
            expect(url).toContain('/vectorstore/aec');
            expect(init.method).toBe('DELETE');
        });
    });

    describe('docstore_components_*', () => {
        it('loaders → mapped components', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk([SAMPLE_NODE]));
            const result = await docstoreComponentsLoadersHandler({});
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.count).toBe(1);
                expect(result.data.components[0]?.name).toBe('s3');
                expect(result.data.components[0]?.inputs).toHaveLength(1);
            }
        });

        it('embeddings → правильный endpoint', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk([]));
            await docstoreComponentsEmbeddingsHandler({});
            const [url] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
            expect(url).toContain('/components/embeddings');
        });

        it('vectorstore → правильный endpoint', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk([]));
            await docstoreComponentsVectorstoreHandler({});
            const [url] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
            expect(url).toContain('/components/vectorstore');
        });

        it('recordmanager → правильный endpoint', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk([]));
            await docstoreComponentsRecordManagerHandler({});
            const [url] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
            expect(url).toContain('/components/recordmanager');
        });
    });
});
