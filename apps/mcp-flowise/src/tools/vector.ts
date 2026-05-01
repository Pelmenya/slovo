import { z } from 'zod';
import { getFlowiseClient } from '../config';
import { ENDPOINTS } from '@slovo/flowise-client';
import { withErrorHandling } from './_helpers';
import type { TToolResult } from './t-tool';

// =============================================================================
// vector_upsert (POST /api/v1/vector/upsert/:chatflowId)
// =============================================================================
//
// Используется для Chatflows со встроенным vector store узлом (Pinecone/Postgres/...
// прямо в флоу), а не Document Store. Эквивалент кнопки "Upsert Vector Database"
// в UI на самом chatflow. Принимает overrideConfig для динамической подстановки
// конфига (через apiConfig overrideConfig в Chatflow Configuration).
// =============================================================================

export const vectorUpsertSchema = z.object({
    chatflowId: z.string().min(1).describe('ID Chatflow со встроенным vector store узлом'),
    overrideConfig: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Override конфигурации vector store / loader узлов'),
    stopNodeId: z
        .string()
        .optional()
        .describe('ID узла на котором остановиться (для частичного upsert)'),
});
export type TVectorUpsertInput = z.infer<typeof vectorUpsertSchema>;

export type TVectorUpsertData = {
    numAdded?: number;
    numUpdated?: number;
    numSkipped?: number;
    numDeleted?: number;
    [key: string]: unknown;
};

export async function vectorUpsertHandler(
    input: TVectorUpsertInput,
): Promise<TToolResult<TVectorUpsertData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        const { chatflowId, ...body } = input;
        return client.request<TVectorUpsertData>(ENDPOINTS.vectorUpsert(chatflowId), {
            method: 'POST',
            body,
        });
    });
}
