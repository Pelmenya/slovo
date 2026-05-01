import { z } from 'zod';
import { getFlowiseClient } from '../config';
import { ENDPOINTS } from '@slovo/flowise-client';
import type {
    TFlowiseComponentNode,
    TFlowiseDocumentStore,
    TFlowiseDocumentStoreChunk,
    TFlowiseDocumentStoreChunksResponse,
    TFlowiseDocumentStoreLoader,
    TFlowiseLoaderPreviewResponse,
    TFlowiseQueryResponse,
} from '@slovo/flowise-client';
import { withErrorHandling } from './_helpers';
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
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        const list = await client.request<TFlowiseDocumentStore[]>(ENDPOINTS.documentStores);
        return {
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
        };
    });
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
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        return client.request<TFlowiseDocumentStore>(ENDPOINTS.documentStoreById(input.storeId));
    });
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
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        return client.request<TFlowiseDocumentStore>(ENDPOINTS.documentStores, {
            method: 'POST',
            body: { name: input.name, description: input.description ?? '' },
        });
    });
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
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        const { storeId, ...rest } = input;
        return client.request<TFlowiseDocumentStore>(ENDPOINTS.documentStoreById(storeId), {
            method: 'PUT',
            body: rest,
        });
    });
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
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        await client.request<unknown>(ENDPOINTS.documentStoreById(input.storeId), {
            method: 'DELETE',
        });
        return { ok: true as const };
    });
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
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        const { storeId, ...rest } = input;
        return client.request<TDocstoreUpsertData>(ENDPOINTS.documentStoreUpsert(storeId), {
            method: 'POST',
            body: rest,
        });
    });
}

// =============================================================================
// docstore_refresh (POST /document-store/refresh/:id)
// =============================================================================

export const docstoreRefreshSchema = z.object({
    storeId: z.string().min(1),
});
export type TDocstoreRefreshInput = z.infer<typeof docstoreRefreshSchema>;

// Flowise refresh response shape варьируется в зависимости от loader-типов и vectorstore.
// Минимально гарантированы { status, processed }, остальное — provider-specific.
export type TDocstoreRefreshData = {
    status?: string;
    processed?: number;
    [key: string]: unknown;
};

export async function docstoreRefreshHandler(
    input: TDocstoreRefreshInput,
): Promise<TToolResult<TDocstoreRefreshData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        return client.request<TDocstoreRefreshData>(ENDPOINTS.documentStoreRefresh(input.storeId), {
            method: 'POST',
            body: {},
        });
    });
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
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        return client.request<TFlowiseDocumentStoreLoader>(ENDPOINTS.docstoreLoaderSave, {
            method: 'POST',
            body: input,
        });
    });
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
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        const { loaderId, storeId, ...rest } = input;
        return client.request<TDocstoreLoaderProcessData>(
            ENDPOINTS.docstoreLoaderProcess(loaderId),
            { method: 'POST', body: { storeId, id: loaderId, ...rest } },
        );
    });
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
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        return client.request<TFlowiseLoaderPreviewResponse>(ENDPOINTS.docstoreLoaderPreview, {
            method: 'POST',
            body: input,
        });
    });
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
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        await client.request<unknown>(ENDPOINTS.docstoreLoaderDelete(input.storeId, input.loaderId), {
            method: 'DELETE',
        });
        return { ok: true as const };
    });
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
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        return client.request<TFlowiseDocumentStoreChunksResponse>(
            ENDPOINTS.docstoreChunksList(input.storeId, input.fileId, input.pageNo),
        );
    });
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
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        const body = { pageContent: input.pageContent, metadata: input.metadata ?? {} };
        return client.request<TFlowiseDocumentStoreChunksResponse>(
            ENDPOINTS.docstoreChunkUpdate(input.storeId, input.loaderId, input.chunkId),
            { method: 'PUT', body },
        );
    });
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
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        await client.request<unknown>(
            ENDPOINTS.docstoreChunkDelete(input.storeId, input.loaderId, input.chunkId),
            { method: 'DELETE' },
        );
        return { ok: true as const };
    });
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
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        const body: Record<string, unknown> = { storeId: input.storeId, query: input.query };
        if (input.topK !== undefined) {
            body.topK = input.topK;
        }
        const response = await client.request<TFlowiseQueryResponse>(ENDPOINTS.vectorstoreQuery, {
            method: 'POST',
            body,
        });
        return {
            timeTaken: response.timeTaken,
            count: response.docs.length,
            docs: response.docs.map((d) => ({
                id: d.id,
                chunkNo: d.chunkNo,
                pageContent: d.pageContent,
                metadata: d.metadata,
            })),
        };
    });
}

// =============================================================================
// docstore_vectorstore_save / insert / update — общая schema (все принимают
// storeId + embeddingConfig + vectorStoreConfig + recordManagerConfig)
// =============================================================================

const vectorstoreConfigSchema = z.object({
    storeId: z.string().min(1),
    embeddingName: z.string().optional(),
    embeddingConfig: z.record(z.string(), z.unknown()).optional(),
    vectorStoreName: z.string().optional(),
    vectorStoreConfig: z.record(z.string(), z.unknown()).optional(),
    recordManagerName: z.string().optional(),
    recordManagerConfig: z.record(z.string(), z.unknown()).optional(),
});

export const docstoreVectorstoreSaveSchema = vectorstoreConfigSchema;
export type TDocstoreVectorstoreSaveInput = z.infer<typeof docstoreVectorstoreSaveSchema>;
export type TDocstoreVectorstoreSaveData = TFlowiseDocumentStore;

export async function docstoreVectorstoreSaveHandler(
    input: TDocstoreVectorstoreSaveInput,
): Promise<TToolResult<TDocstoreVectorstoreSaveData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        return client.request<TFlowiseDocumentStore>(ENDPOINTS.vectorstoreSave, {
            method: 'POST',
            body: input,
        });
    });
}

export const docstoreVectorstoreInsertSchema = vectorstoreConfigSchema;
export type TDocstoreVectorstoreInsertInput = z.infer<typeof docstoreVectorstoreInsertSchema>;
export type TDocstoreVectorstoreInsertData = Record<string, unknown>;

export async function docstoreVectorstoreInsertHandler(
    input: TDocstoreVectorstoreInsertInput,
): Promise<TToolResult<TDocstoreVectorstoreInsertData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        return client.request<TDocstoreVectorstoreInsertData>(ENDPOINTS.vectorstoreInsert, {
            method: 'POST',
            body: input,
        });
    });
}

export const docstoreVectorstoreUpdateSchema = vectorstoreConfigSchema;
export type TDocstoreVectorstoreUpdateInput = z.infer<typeof docstoreVectorstoreUpdateSchema>;
export type TDocstoreVectorstoreUpdateData = TFlowiseDocumentStore;

export async function docstoreVectorstoreUpdateHandler(
    input: TDocstoreVectorstoreUpdateInput,
): Promise<TToolResult<TDocstoreVectorstoreUpdateData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        return client.request<TFlowiseDocumentStore>(ENDPOINTS.vectorstoreUpdate, {
            method: 'POST',
            body: input,
        });
    });
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
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        await client.request<unknown>(ENDPOINTS.vectorstoreDelete(input.storeId), {
            method: 'DELETE',
        });
        return { ok: true as const };
    });
}

// =============================================================================
// docstore_generate_tool_desc — авто-генерация description для DocStore как tool
// для агента (Flowise сам через LLM генерирует описание)
// =============================================================================

export const docstoreGenerateToolDescSchema = z.object({
    storeId: z.string().min(1),
    selectedChatModel: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Опциональный chat model node для генерации (если не задан — Flowise default)'),
});
export type TDocstoreGenerateToolDescInput = z.infer<typeof docstoreGenerateToolDescSchema>;

export type TDocstoreGenerateToolDescData = {
    description?: string;
    [key: string]: unknown;
};

export async function docstoreGenerateToolDescHandler(
    input: TDocstoreGenerateToolDescInput,
): Promise<TToolResult<TDocstoreGenerateToolDescData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        const { storeId, ...body } = input;
        return client.request<TDocstoreGenerateToolDescData>(
            ENDPOINTS.docstoreGenerateToolDesc(storeId),
            { method: 'POST', body },
        );
    });
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
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        const list = await client.request<TFlowiseComponentNode[]>(endpoint);
        return { count: list.length, components: list.map(mapComponent) };
    });
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
