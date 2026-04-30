import { z } from 'zod';
import { getFlowiseClient } from '../api/client';
import { ENDPOINTS } from '../api/endpoints';
import { formatErrorForMcp } from '../utils/errors';
import type {
    TFlowiseComponentNode,
    TFlowiseDocumentStore,
    TFlowiseDocumentStoreChunk,
    TFlowiseDocumentStoreChunksResponse,
    TFlowiseDocumentStoreLoader,
    TFlowiseLoaderPreviewResponse,
    TFlowiseQueryResponse,
} from '../api/t-flowise';
import type { TToolResult } from './t-tool';

// =============================================================================
// docstore_list
// =============================================================================

export const docstoreListSchema = z.object({});
export type TDocstoreListInput = z.infer<typeof docstoreListSchema>;

export type TDocstoreListItem = {
    id: string;
    name: string;
    description: string | null;
    status: string;
    totalChunks: number;
    totalChars: number;
    loadersCount: number;
    hasEmbedding: boolean;
    hasVectorStore: boolean;
};

export type TDocstoreListData = {
    count: number;
    stores: TDocstoreListItem[];
};

export async function docstoreListHandler(
    _input: TDocstoreListInput,
): Promise<TToolResult<TDocstoreListData>> {
    try {
        const client = getFlowiseClient();
        const list = await client.request<TFlowiseDocumentStore[]>(ENDPOINTS.documentStores);
        return {
            success: true,
            data: {
                count: list.length,
                stores: list.map((s) => ({
                    id: s.id,
                    name: s.name,
                    description: s.description ?? null,
                    status: s.status,
                    totalChunks: s.totalChunks,
                    totalChars: s.totalChars,
                    loadersCount: Array.isArray(s.loaders) ? s.loaders.length : 0,
                    hasEmbedding: Boolean(s.embeddingConfig),
                    hasVectorStore: Boolean(s.vectorStoreConfig),
                })),
            },
        };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
}

// =============================================================================
// docstore_get
// =============================================================================

export const docstoreGetSchema = z.object({
    storeId: z.string().min(1).describe('ID Document Store (uuid)'),
});
export type TDocstoreGetInput = z.infer<typeof docstoreGetSchema>;

export type TDocstoreGetData = TFlowiseDocumentStore;

export async function docstoreGetHandler(
    input: TDocstoreGetInput,
): Promise<TToolResult<TDocstoreGetData>> {
    try {
        const client = getFlowiseClient();
        const store = await client.request<TFlowiseDocumentStore>(
            ENDPOINTS.documentStoreById(input.storeId),
        );
        return { success: true, data: store };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
}

// =============================================================================
// docstore_create
// =============================================================================

export const docstoreCreateSchema = z.object({
    name: z.string().min(1).describe('Имя Document Store'),
    description: z.string().optional().describe('Описание (опционально)'),
});
export type TDocstoreCreateInput = z.infer<typeof docstoreCreateSchema>;

export type TDocstoreCreateData = TFlowiseDocumentStore;

export async function docstoreCreateHandler(
    input: TDocstoreCreateInput,
): Promise<TToolResult<TDocstoreCreateData>> {
    try {
        const client = getFlowiseClient();
        const store = await client.request<TFlowiseDocumentStore>(ENDPOINTS.documentStores, {
            method: 'POST',
            body: { name: input.name, description: input.description ?? '' },
        });
        return { success: true, data: store };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
}

// =============================================================================
// docstore_update
// =============================================================================

export const docstoreUpdateSchema = z.object({
    storeId: z.string().min(1),
    name: z.string().min(1).optional(),
    description: z.string().optional(),
});
export type TDocstoreUpdateInput = z.infer<typeof docstoreUpdateSchema>;

export type TDocstoreUpdateData = TFlowiseDocumentStore;

export async function docstoreUpdateHandler(
    input: TDocstoreUpdateInput,
): Promise<TToolResult<TDocstoreUpdateData>> {
    try {
        const client = getFlowiseClient();
        const body: Record<string, unknown> = {};
        if (input.name !== undefined) body.name = input.name;
        if (input.description !== undefined) body.description = input.description;
        const store = await client.request<TFlowiseDocumentStore>(
            ENDPOINTS.documentStoreById(input.storeId),
            { method: 'PUT', body },
        );
        return { success: true, data: store };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
}

// =============================================================================
// docstore_delete
// =============================================================================

export const docstoreDeleteSchema = z.object({
    storeId: z.string().min(1),
});
export type TDocstoreDeleteInput = z.infer<typeof docstoreDeleteSchema>;

export type TDocstoreDeleteData = { ok: true };

export async function docstoreDeleteHandler(
    input: TDocstoreDeleteInput,
): Promise<TToolResult<TDocstoreDeleteData>> {
    try {
        const client = getFlowiseClient();
        await client.request<unknown>(ENDPOINTS.documentStoreById(input.storeId), {
            method: 'DELETE',
        });
        return { success: true, data: { ok: true } };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
}

// =============================================================================
// docstore_upsert (POST /document-store/upsert/:id)
// =============================================================================

export const docstoreUpsertSchema = z.object({
    storeId: z.string().min(1),
    docId: z
        .string()
        .optional()
        .describe('ID существующего loader для re-upsert (опционально, если не задан — новый loader)'),
    overrideConfig: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Override конфигурации loader/splitter/embedding/vectorstore'),
});
export type TDocstoreUpsertInput = z.infer<typeof docstoreUpsertSchema>;

export type TDocstoreUpsertData = {
    numAdded?: number;
    numUpdated?: number;
    numSkipped?: number;
    numDeleted?: number;
    [key: string]: unknown;
};

export async function docstoreUpsertHandler(
    input: TDocstoreUpsertInput,
): Promise<TToolResult<TDocstoreUpsertData>> {
    try {
        const client = getFlowiseClient();
        const body: Record<string, unknown> = {};
        if (input.docId !== undefined) body.docId = input.docId;
        if (input.overrideConfig !== undefined) body.overrideConfig = input.overrideConfig;
        const result = await client.request<TDocstoreUpsertData>(
            ENDPOINTS.documentStoreUpsert(input.storeId),
            { method: 'POST', body },
        );
        return { success: true, data: result };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
}

// =============================================================================
// docstore_refresh (POST /document-store/refresh/:id)
// =============================================================================

export const docstoreRefreshSchema = z.object({
    storeId: z.string().min(1),
});
export type TDocstoreRefreshInput = z.infer<typeof docstoreRefreshSchema>;

export type TDocstoreRefreshData = Record<string, unknown>;

export async function docstoreRefreshHandler(
    input: TDocstoreRefreshInput,
): Promise<TToolResult<TDocstoreRefreshData>> {
    try {
        const client = getFlowiseClient();
        const result = await client.request<TDocstoreRefreshData>(
            ENDPOINTS.documentStoreRefresh(input.storeId),
            { method: 'POST', body: {} },
        );
        return { success: true, data: result };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
}

// =============================================================================
// docstore_loader_save (POST /document-store/loader/save)
// =============================================================================

export const docstoreLoaderSaveSchema = z.object({
    storeId: z.string().min(1),
    loaderId: z.string().min(1).describe('Имя ноды (например, "S3", "json", "textFile")'),
    loaderName: z.string().min(1),
    loaderConfig: z.record(z.string(), z.unknown()).describe('Конфиг loader-ноды (bucket, keyName, region и т.д.)'),
    splitterId: z.string().optional(),
    splitterName: z.string().optional(),
    splitterConfig: z.record(z.string(), z.unknown()).optional(),
    credential: z.string().optional().describe('credentialId если loader требует'),
    id: z
        .string()
        .optional()
        .describe('ID существующего loader для update (опционально — иначе создаётся новый)'),
});
export type TDocstoreLoaderSaveInput = z.infer<typeof docstoreLoaderSaveSchema>;

export type TDocstoreLoaderSaveData = TFlowiseDocumentStoreLoader;

export async function docstoreLoaderSaveHandler(
    input: TDocstoreLoaderSaveInput,
): Promise<TToolResult<TDocstoreLoaderSaveData>> {
    try {
        const client = getFlowiseClient();
        const result = await client.request<TFlowiseDocumentStoreLoader>(
            ENDPOINTS.docstoreLoaderSave,
            { method: 'POST', body: input },
        );
        return { success: true, data: result };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
}

// =============================================================================
// docstore_loader_process (POST /document-store/loader/process/:loaderId)
// =============================================================================

export const docstoreLoaderProcessSchema = z.object({
    storeId: z.string().min(1),
    loaderId: z.string().min(1).describe('ID loader-а (uuid из loader_save response)'),
    loaderConfig: z.record(z.string(), z.unknown()).optional(),
    splitterId: z.string().optional(),
    splitterConfig: z.record(z.string(), z.unknown()).optional(),
});
export type TDocstoreLoaderProcessInput = z.infer<typeof docstoreLoaderProcessSchema>;

export type TDocstoreLoaderProcessData = {
    chunks: TFlowiseDocumentStoreChunk[];
    count: number;
    file?: TFlowiseDocumentStoreLoader;
    [key: string]: unknown;
};

export async function docstoreLoaderProcessHandler(
    input: TDocstoreLoaderProcessInput,
): Promise<TToolResult<TDocstoreLoaderProcessData>> {
    try {
        const client = getFlowiseClient();
        const { loaderId, storeId, ...rest } = input;
        const result = await client.request<TDocstoreLoaderProcessData>(
            ENDPOINTS.docstoreLoaderProcess(loaderId),
            { method: 'POST', body: { storeId, id: loaderId, ...rest } },
        );
        return { success: true, data: result };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
}

// =============================================================================
// docstore_loader_preview (POST /document-store/loader/preview)
// =============================================================================

export const docstoreLoaderPreviewSchema = z.object({
    storeId: z.string().min(1),
    loaderId: z.string().min(1).describe('Имя ноды (например, "S3", "json")'),
    loaderName: z.string().min(1),
    loaderConfig: z.record(z.string(), z.unknown()),
    splitterId: z.string().optional(),
    splitterConfig: z.record(z.string(), z.unknown()).optional(),
    previewChunkCount: z.number().int().min(1).max(100).optional().describe('По умолчанию 20'),
});
export type TDocstoreLoaderPreviewInput = z.infer<typeof docstoreLoaderPreviewSchema>;

export type TDocstoreLoaderPreviewData = TFlowiseLoaderPreviewResponse;

export async function docstoreLoaderPreviewHandler(
    input: TDocstoreLoaderPreviewInput,
): Promise<TToolResult<TDocstoreLoaderPreviewData>> {
    try {
        const client = getFlowiseClient();
        const result = await client.request<TFlowiseLoaderPreviewResponse>(
            ENDPOINTS.docstoreLoaderPreview,
            { method: 'POST', body: input },
        );
        return { success: true, data: result };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
}

// =============================================================================
// docstore_loader_delete (DELETE /document-store/loader/:storeId/:loaderId)
// =============================================================================

export const docstoreLoaderDeleteSchema = z.object({
    storeId: z.string().min(1),
    loaderId: z.string().min(1),
});
export type TDocstoreLoaderDeleteInput = z.infer<typeof docstoreLoaderDeleteSchema>;

export type TDocstoreLoaderDeleteData = { ok: true };

export async function docstoreLoaderDeleteHandler(
    input: TDocstoreLoaderDeleteInput,
): Promise<TToolResult<TDocstoreLoaderDeleteData>> {
    try {
        const client = getFlowiseClient();
        await client.request<unknown>(ENDPOINTS.docstoreLoaderDelete(input.storeId, input.loaderId), {
            method: 'DELETE',
        });
        return { success: true, data: { ok: true } };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
}

// =============================================================================
// docstore_chunks_list (GET /document-store/chunks/:storeId/:fileId/:pageNo)
// =============================================================================

export const docstoreChunksListSchema = z.object({
    storeId: z.string().min(1),
    fileId: z.string().min(1).describe('ID loader (file)'),
    pageNo: z.number().int().min(1).default(1),
});
export type TDocstoreChunksListInput = z.infer<typeof docstoreChunksListSchema>;

export type TDocstoreChunksListData = TFlowiseDocumentStoreChunksResponse;

export async function docstoreChunksListHandler(
    input: TDocstoreChunksListInput,
): Promise<TToolResult<TDocstoreChunksListData>> {
    try {
        const client = getFlowiseClient();
        const result = await client.request<TFlowiseDocumentStoreChunksResponse>(
            ENDPOINTS.docstoreChunksList(input.storeId, input.fileId, input.pageNo),
        );
        return { success: true, data: result };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
}

// =============================================================================
// docstore_chunk_update (PUT /document-store/chunks/:storeId/:loaderId/:chunkId)
// =============================================================================

export const docstoreChunkUpdateSchema = z.object({
    storeId: z.string().min(1),
    loaderId: z.string().min(1),
    chunkId: z.string().min(1),
    pageContent: z.string().min(1),
    metadata: z.record(z.string(), z.unknown()).optional(),
});
export type TDocstoreChunkUpdateInput = z.infer<typeof docstoreChunkUpdateSchema>;

export type TDocstoreChunkUpdateData = TFlowiseDocumentStoreChunksResponse;

export async function docstoreChunkUpdateHandler(
    input: TDocstoreChunkUpdateInput,
): Promise<TToolResult<TDocstoreChunkUpdateData>> {
    try {
        const client = getFlowiseClient();
        const body = { pageContent: input.pageContent, metadata: input.metadata ?? {} };
        const result = await client.request<TFlowiseDocumentStoreChunksResponse>(
            ENDPOINTS.docstoreChunkUpdate(input.storeId, input.loaderId, input.chunkId),
            { method: 'PUT', body },
        );
        return { success: true, data: result };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
}

// =============================================================================
// docstore_chunk_delete (DELETE /document-store/chunks/:storeId/:loaderId/:chunkId)
// =============================================================================

export const docstoreChunkDeleteSchema = z.object({
    storeId: z.string().min(1),
    loaderId: z.string().min(1),
    chunkId: z.string().min(1),
});
export type TDocstoreChunkDeleteInput = z.infer<typeof docstoreChunkDeleteSchema>;

export type TDocstoreChunkDeleteData = { ok: true };

export async function docstoreChunkDeleteHandler(
    input: TDocstoreChunkDeleteInput,
): Promise<TToolResult<TDocstoreChunkDeleteData>> {
    try {
        const client = getFlowiseClient();
        await client.request<unknown>(
            ENDPOINTS.docstoreChunkDelete(input.storeId, input.loaderId, input.chunkId),
            { method: 'DELETE' },
        );
        return { success: true, data: { ok: true } };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
}

// =============================================================================
// docstore_query (POST /document-store/vectorstore/query)
// =============================================================================

export const docstoreQuerySchema = z.object({
    storeId: z.string().min(1).describe('ID Document Store (uuid)'),
    query: z.string().min(1).describe('Текст запроса для retrieval'),
    topK: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe('Сколько чанков вернуть (по умолчанию определяется vectorStoreConfig)'),
});
export type TDocstoreQueryInput = z.infer<typeof docstoreQuerySchema>;

export type TDocstoreQueryData = {
    timeTaken: number;
    count: number;
    docs: Array<{
        id: string;
        chunkNo?: number;
        pageContent: string;
        metadata: Record<string, unknown>;
    }>;
};

export async function docstoreQueryHandler(
    input: TDocstoreQueryInput,
): Promise<TToolResult<TDocstoreQueryData>> {
    try {
        const client = getFlowiseClient();
        const body: Record<string, unknown> = {
            storeId: input.storeId,
            query: input.query,
        };
        if (input.topK !== undefined) {
            body.topK = input.topK;
        }
        const response = await client.request<TFlowiseQueryResponse>(ENDPOINTS.vectorstoreQuery, {
            method: 'POST',
            body,
        });
        return {
            success: true,
            data: {
                timeTaken: response.timeTaken,
                count: response.docs.length,
                docs: response.docs.map((d) => ({
                    id: d.id,
                    chunkNo: d.chunkNo,
                    pageContent: d.pageContent,
                    metadata: d.metadata,
                })),
            },
        };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
}

// =============================================================================
// docstore_vectorstore_save (POST /document-store/vectorstore/save)
// =============================================================================

export const docstoreVectorstoreSaveSchema = z.object({
    storeId: z.string().min(1),
    embeddingName: z.string().optional(),
    embeddingConfig: z.record(z.string(), z.unknown()).optional(),
    vectorStoreName: z.string().optional(),
    vectorStoreConfig: z.record(z.string(), z.unknown()).optional(),
    recordManagerName: z.string().optional(),
    recordManagerConfig: z.record(z.string(), z.unknown()).optional(),
});
export type TDocstoreVectorstoreSaveInput = z.infer<typeof docstoreVectorstoreSaveSchema>;

export type TDocstoreVectorstoreSaveData = TFlowiseDocumentStore;

export async function docstoreVectorstoreSaveHandler(
    input: TDocstoreVectorstoreSaveInput,
): Promise<TToolResult<TDocstoreVectorstoreSaveData>> {
    try {
        const client = getFlowiseClient();
        const result = await client.request<TFlowiseDocumentStore>(ENDPOINTS.vectorstoreSave, {
            method: 'POST',
            body: input,
        });
        return { success: true, data: result };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
}

// =============================================================================
// docstore_vectorstore_insert (POST /document-store/vectorstore/insert)
// =============================================================================

export const docstoreVectorstoreInsertSchema = z.object({
    storeId: z.string().min(1),
    embeddingName: z.string().optional(),
    embeddingConfig: z.record(z.string(), z.unknown()).optional(),
    vectorStoreName: z.string().optional(),
    vectorStoreConfig: z.record(z.string(), z.unknown()).optional(),
    recordManagerName: z.string().optional(),
    recordManagerConfig: z.record(z.string(), z.unknown()).optional(),
});
export type TDocstoreVectorstoreInsertInput = z.infer<typeof docstoreVectorstoreInsertSchema>;

export type TDocstoreVectorstoreInsertData = Record<string, unknown>;

export async function docstoreVectorstoreInsertHandler(
    input: TDocstoreVectorstoreInsertInput,
): Promise<TToolResult<TDocstoreVectorstoreInsertData>> {
    try {
        const client = getFlowiseClient();
        const result = await client.request<TDocstoreVectorstoreInsertData>(
            ENDPOINTS.vectorstoreInsert,
            { method: 'POST', body: input },
        );
        return { success: true, data: result };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
}

// =============================================================================
// docstore_vectorstore_update (POST /document-store/vectorstore/update)
// =============================================================================

export const docstoreVectorstoreUpdateSchema = z.object({
    storeId: z.string().min(1),
    embeddingName: z.string().optional(),
    embeddingConfig: z.record(z.string(), z.unknown()).optional(),
    vectorStoreName: z.string().optional(),
    vectorStoreConfig: z.record(z.string(), z.unknown()).optional(),
    recordManagerName: z.string().optional(),
    recordManagerConfig: z.record(z.string(), z.unknown()).optional(),
});
export type TDocstoreVectorstoreUpdateInput = z.infer<typeof docstoreVectorstoreUpdateSchema>;

export type TDocstoreVectorstoreUpdateData = TFlowiseDocumentStore;

export async function docstoreVectorstoreUpdateHandler(
    input: TDocstoreVectorstoreUpdateInput,
): Promise<TToolResult<TDocstoreVectorstoreUpdateData>> {
    try {
        const client = getFlowiseClient();
        const result = await client.request<TFlowiseDocumentStore>(ENDPOINTS.vectorstoreUpdate, {
            method: 'POST',
            body: input,
        });
        return { success: true, data: result };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
}

// =============================================================================
// docstore_vectorstore_delete (DELETE /document-store/vectorstore/:storeId)
// =============================================================================

export const docstoreVectorstoreDeleteSchema = z.object({
    storeId: z.string().min(1),
});
export type TDocstoreVectorstoreDeleteInput = z.infer<typeof docstoreVectorstoreDeleteSchema>;

export type TDocstoreVectorstoreDeleteData = { ok: true };

export async function docstoreVectorstoreDeleteHandler(
    input: TDocstoreVectorstoreDeleteInput,
): Promise<TToolResult<TDocstoreVectorstoreDeleteData>> {
    try {
        const client = getFlowiseClient();
        await client.request<unknown>(ENDPOINTS.vectorstoreDelete(input.storeId), {
            method: 'DELETE',
        });
        return { success: true, data: { ok: true } };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
}

// =============================================================================
// docstore_components_* (GET /document-store/components/{loaders,embeddings,vectorstore,recordmanager})
// =============================================================================

export const docstoreComponentsSchema = z.object({});
export type TDocstoreComponentsInput = z.infer<typeof docstoreComponentsSchema>;

export type TDocstoreComponentsItem = {
    name: string;
    label: string;
    category: string;
    description?: string;
    inputs?: Array<{ name: string; label: string; type: string; optional?: boolean }>;
};

export type TDocstoreComponentsData = {
    count: number;
    components: TDocstoreComponentsItem[];
};

function mapComponent(node: TFlowiseComponentNode): TDocstoreComponentsItem {
    return {
        name: node.name,
        label: node.label,
        category: node.category,
        description: node.description,
        inputs: Array.isArray(node.inputs)
            ? node.inputs.map((i) => ({
                  name: i.name,
                  label: i.label,
                  type: i.type,
                  optional: i.optional,
              }))
            : undefined,
    };
}

async function fetchComponents(endpoint: string): Promise<TToolResult<TDocstoreComponentsData>> {
    try {
        const client = getFlowiseClient();
        const list = await client.request<TFlowiseComponentNode[]>(endpoint);
        return {
            success: true,
            data: {
                count: list.length,
                components: list.map(mapComponent),
            },
        };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
}

export async function docstoreComponentsLoadersHandler(
    _input: TDocstoreComponentsInput,
): Promise<TToolResult<TDocstoreComponentsData>> {
    return fetchComponents(ENDPOINTS.docstoreComponentsLoaders);
}

export async function docstoreComponentsEmbeddingsHandler(
    _input: TDocstoreComponentsInput,
): Promise<TToolResult<TDocstoreComponentsData>> {
    return fetchComponents(ENDPOINTS.docstoreComponentsEmbeddings);
}

export async function docstoreComponentsVectorstoreHandler(
    _input: TDocstoreComponentsInput,
): Promise<TToolResult<TDocstoreComponentsData>> {
    return fetchComponents(ENDPOINTS.docstoreComponentsVectorstore);
}

export async function docstoreComponentsRecordManagerHandler(
    _input: TDocstoreComponentsInput,
): Promise<TToolResult<TDocstoreComponentsData>> {
    return fetchComponents(ENDPOINTS.docstoreComponentsRecordManager);
}
