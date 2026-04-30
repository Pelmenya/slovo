import { z } from 'zod';
import { chatflowCreateHandler, chatflowGetHandler } from './chatflow';
import {
    docstoreCreateHandler,
    docstoreGetHandler,
    docstoreLoaderProcessHandler,
    docstoreLoaderSaveHandler,
    docstoreVectorstoreInsertHandler,
    docstoreVectorstoreSaveHandler,
} from './docstore';
import type { TFlowiseChatflow, TFlowiseDocumentStore } from '../api/t-flowise';
import type { TToolResult } from './t-tool';

// =============================================================================
// chatflow_clone — get(включая flowData) → modify name → create
// =============================================================================

export const chatflowCloneSchema = z.object({
    sourceChatflowId: z.string().min(1).describe('ID исходного chatflow'),
    name: z.string().min(1).describe('Имя для нового chatflow'),
    deployed: z.boolean().optional().describe('По умолчанию false для безопасного клона'),
    isPublic: z.boolean().optional().describe('По умолчанию false'),
    transformFlowData: z
        .string()
        .optional()
        .describe('Опционально: новый flowData (если не задан — копируется из исходного)'),
});
export type TChatflowCloneInput = z.infer<typeof chatflowCloneSchema>;

export type TChatflowCloneData = TFlowiseChatflow;

export async function chatflowCloneHandler(
    input: TChatflowCloneInput,
): Promise<TToolResult<TChatflowCloneData>> {
    const sourceResult = await chatflowGetHandler({
        chatflowId: input.sourceChatflowId,
        includeFlowData: true,
    });
    if (!sourceResult.success) {
        return sourceResult;
    }
    const source = sourceResult.data;
    return chatflowCreateHandler({
        name: input.name,
        flowData: input.transformFlowData ?? (source.flowData ?? '{"nodes":[],"edges":[]}'),
        deployed: input.deployed ?? false,
        isPublic: input.isPublic ?? false,
        type: source.type as 'CHATFLOW' | 'AGENTFLOW' | 'MULTIAGENT' | 'ASSISTANT' | undefined,
        category: source.category ?? undefined,
        chatbotConfig: source.chatbotConfig ?? undefined,
        apiConfig: source.apiConfig ?? undefined,
    });
}

// =============================================================================
// docstore_clone — create новый store + перенос embedding/vectorstore configs
//
// Useful для A/B testing на разных embedding-моделях. Loader-ы НЕ копируются
// (они привязаны к конкретному источнику данных), только store + configs.
// =============================================================================

export const docstoreCloneSchema = z.object({
    sourceStoreId: z.string().min(1).describe('ID исходного Document Store'),
    name: z.string().min(1).describe('Имя для нового store'),
    description: z.string().optional(),
    overrideEmbeddingConfig: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Override embedding config (например, другой modelName)'),
    overrideVectorStoreConfig: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Override vector store config (например, другая tableName)'),
});
export type TDocstoreCloneInput = z.infer<typeof docstoreCloneSchema>;

export type TDocstoreCloneData = TFlowiseDocumentStore;

function parseConfigField(raw: string | null): { name?: string; config?: Record<string, unknown> } | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as { name?: string; config?: Record<string, unknown> };
        return parsed;
    } catch {
        return null;
    }
}

export async function docstoreCloneHandler(
    input: TDocstoreCloneInput,
): Promise<TToolResult<TDocstoreCloneData>> {
    const sourceResult = await docstoreGetHandler({ storeId: input.sourceStoreId });
    if (!sourceResult.success) {
        return sourceResult;
    }
    const source = sourceResult.data;
    const createResult = await docstoreCreateHandler({
        name: input.name,
        description: input.description ?? source.description ?? '',
    });
    if (!createResult.success) {
        return createResult;
    }
    const newStore = createResult.data;

    const sourceEmbedding = parseConfigField(source.embeddingConfig);
    const sourceVectorStore = parseConfigField(source.vectorStoreConfig);
    if (!sourceEmbedding?.name && !sourceVectorStore?.name) {
        return { success: true, data: newStore };
    }

    const saveResult = await docstoreVectorstoreSaveHandler({
        storeId: newStore.id,
        embeddingName: sourceEmbedding?.name,
        embeddingConfig: input.overrideEmbeddingConfig ?? sourceEmbedding?.config,
        vectorStoreName: sourceVectorStore?.name,
        vectorStoreConfig: input.overrideVectorStoreConfig ?? sourceVectorStore?.config,
    });
    if (!saveResult.success) {
        return saveResult;
    }
    return { success: true, data: saveResult.data };
}

// =============================================================================
// docstore_full_setup — атомарный onboarding нового каталога:
// create_store → loader_save → loader_process → vectorstore_save → vectorstore_insert
// =============================================================================

export const docstoreFullSetupSchema = z.object({
    name: z.string().min(1).describe('Имя нового Document Store'),
    description: z.string().optional(),

    // Loader (типа S3, JSON, PDF, ...)
    loaderId: z.string().min(1).describe('Имя ноды loader (например, "S3", "json")'),
    loaderName: z.string().min(1),
    loaderConfig: z.record(z.string(), z.unknown()),
    credential: z.string().optional().describe('credentialId для loader'),

    // Splitter
    splitterId: z.string().optional(),
    splitterName: z.string().optional(),
    splitterConfig: z.record(z.string(), z.unknown()).optional(),

    // Embedding
    embeddingName: z.string().min(1).describe('Имя embedding-провайдера (openAIEmbeddings, ...)'),
    embeddingConfig: z.record(z.string(), z.unknown()),

    // Vector Store
    vectorStoreName: z.string().min(1).describe('Имя vector store (postgres, pinecone, ...)'),
    vectorStoreConfig: z.record(z.string(), z.unknown()),
});
export type TDocstoreFullSetupInput = z.infer<typeof docstoreFullSetupSchema>;

export type TDocstoreFullSetupData = {
    storeId: string;
    loaderId: string;
    chunksCount: number;
    insertResult: Record<string, unknown>;
};

export async function docstoreFullSetupHandler(
    input: TDocstoreFullSetupInput,
): Promise<TToolResult<TDocstoreFullSetupData>> {
    // 1. create store
    const storeResult = await docstoreCreateHandler({
        name: input.name,
        description: input.description,
    });
    if (!storeResult.success) {
        return storeResult;
    }
    const storeId = storeResult.data.id;

    // 2. save loader
    const loaderResult = await docstoreLoaderSaveHandler({
        storeId,
        loaderId: input.loaderId,
        loaderName: input.loaderName,
        loaderConfig: input.loaderConfig,
        credential: input.credential,
        splitterId: input.splitterId,
        splitterName: input.splitterName,
        splitterConfig: input.splitterConfig,
    });
    if (!loaderResult.success) {
        return loaderResult;
    }
    const loaderId = loaderResult.data.id;

    // 3. process loader (chunking)
    const processResult = await docstoreLoaderProcessHandler({ storeId, loaderId });
    if (!processResult.success) {
        return processResult;
    }

    // 4. save vectorstore config + 5. insert
    const insertResult = await docstoreVectorstoreInsertHandler({
        storeId,
        embeddingName: input.embeddingName,
        embeddingConfig: input.embeddingConfig,
        vectorStoreName: input.vectorStoreName,
        vectorStoreConfig: input.vectorStoreConfig,
    });
    if (!insertResult.success) {
        return insertResult;
    }

    return {
        success: true,
        data: {
            storeId,
            loaderId,
            chunksCount: processResult.data.count,
            insertResult: insertResult.data,
        },
    };
}
