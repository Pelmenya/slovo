import { z } from 'zod';
import { getFlowiseClient } from '../api/client';
import { ENDPOINTS } from '../api/endpoints';
import { formatErrorForMcp } from '../utils/errors';
import type {
    TFlowiseDocumentStore,
    TFlowiseQueryResponse,
} from '../api/t-flowise';
import type { TToolResult } from './t-tool';

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
