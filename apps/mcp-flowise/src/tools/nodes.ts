import { z } from 'zod';
import { getFlowiseClient } from '../config';
import { ENDPOINTS } from '@slovo/flowise-client';
import type { TFlowiseComponentNode } from '@slovo/flowise-client';
import { withErrorHandling } from './_helpers';
import type { TToolResult } from './t-tool';

// =============================================================================
// nodes_list
// =============================================================================

export const nodesListSchema = z.object({
    category: z
        .string()
        .optional()
        .describe('Фильтр по категории (Document Loaders / Chat Models / Embeddings / Tools / ...)'),
});
export type TNodesListInput = z.infer<typeof nodesListSchema>;

export type TNodesListItem = {
    name: string;
    label: string;
    category: string;
    description?: string;
    version: number;
    type: string;
};

export type TNodesListData = {
    count: number;
    nodes: TNodesListItem[];
};

export async function nodesListHandler(
    input: TNodesListInput,
): Promise<TToolResult<TNodesListData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        const endpoint = input.category
            ? ENDPOINTS.nodesByCategory(input.category)
            : ENDPOINTS.nodes;
        const list = await client.request<TFlowiseComponentNode[]>(endpoint);
        return {
            count: list.length,
            nodes: list.map((n) => ({
                name: n.name,
                label: n.label,
                category: n.category,
                description: n.description,
                version: n.version,
                type: n.type,
            })),
        };
    });
}

// =============================================================================
// nodes_get
// =============================================================================

export const nodesGetSchema = z.object({
    name: z
        .string()
        .min(1)
        .describe('Имя ноды (например, "chatAnthropic", "openAIEmbeddings", "S3", "recursiveCharacterTextSplitter")'),
});
export type TNodesGetInput = z.infer<typeof nodesGetSchema>;

export type TNodesGetData = TFlowiseComponentNode;

export async function nodesGetHandler(
    input: TNodesGetInput,
): Promise<TToolResult<TNodesGetData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        return client.request<TFlowiseComponentNode>(ENDPOINTS.nodeByName(input.name));
    });
}
