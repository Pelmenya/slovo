import { z } from 'zod';
import { getFlowiseClient } from '../config';
import { ENDPOINTS } from '@slovo/flowise-client';
import type { TFlowiseChatMessage } from '@slovo/flowise-client';
import { buildQuery, withErrorHandling } from './_helpers';
import type { TToolResult } from './t-tool';

// =============================================================================
// chatmessage_list — Pick без огромных sourceDocuments/fileUploads/usedTools/fileAnnotations
// =============================================================================

export const chatmessageListSchema = z.object({
    chatflowId: z.string().min(1),
    chatId: z.string().optional().describe('Фильтр по конкретной сессии'),
    chatType: z.enum(['EXTERNAL', 'INTERNAL']).optional(),
    sortOrder: z.enum(['ASC', 'DESC']).optional(),
    limit: z.number().int().min(1).max(500).optional(),
});
export type TChatmessageListInput = z.infer<typeof chatmessageListSchema>;

export type TChatmessageListItem = Pick<
    TFlowiseChatMessage,
    'id' | 'role' | 'chatId' | 'content' | 'chatType' | 'sessionId' | 'memoryType' | 'createdDate'
>;

export type TChatmessageListData = {
    count: number;
    messages: TChatmessageListItem[];
};

export async function chatmessageListHandler(
    input: TChatmessageListInput,
): Promise<TToolResult<TChatmessageListData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        const query = buildQuery({
            chatId: input.chatId,
            chatType: input.chatType,
            sortOrder: input.sortOrder,
            limit: input.limit,
        });
        const list = await client.request<TFlowiseChatMessage[]>(
            ENDPOINTS.chatMessages(input.chatflowId),
            { query },
        );
        return {
            count: list.length,
            messages: list.map((m) => ({
                id: m.id,
                role: m.role,
                chatId: m.chatId,
                content: m.content,
                chatType: m.chatType,
                sessionId: m.sessionId,
                memoryType: m.memoryType,
                createdDate: m.createdDate,
            })),
        };
    });
}

// =============================================================================
// chatmessage_abort — прерывает streaming chatflow по ходу
// =============================================================================

export const chatmessageAbortSchema = z.object({
    chatflowId: z.string().min(1),
    chatId: z.string().min(1),
});
export type TChatmessageAbortInput = z.infer<typeof chatmessageAbortSchema>;

export type TChatmessageAbortData = { ok: true };

export async function chatmessageAbortHandler(
    input: TChatmessageAbortInput,
): Promise<TToolResult<TChatmessageAbortData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        await client.request<unknown>(
            ENDPOINTS.chatMessagesAbort(input.chatflowId, input.chatId),
            { method: 'PUT', body: {} },
        );
        return { ok: true as const };
    });
}

// =============================================================================
// chatmessage_delete_all — снос всей истории чатов конкретного chatflow
// (для cleanup при тестах). Опционально с фильтрами.
// =============================================================================

export const chatmessageDeleteAllSchema = z.object({
    chatflowId: z.string().min(1),
    chatId: z.string().optional().describe('Удалить только конкретную сессию'),
    chatType: z.enum(['EXTERNAL', 'INTERNAL']).optional(),
    isClearFromViewMessageDialog: z
        .boolean()
        .optional()
        .describe('Включить cleanup из UI dialog (Flowise-internal)'),
});
export type TChatmessageDeleteAllInput = z.infer<typeof chatmessageDeleteAllSchema>;

export type TChatmessageDeleteAllData = { ok: true };

export async function chatmessageDeleteAllHandler(
    input: TChatmessageDeleteAllInput,
): Promise<TToolResult<TChatmessageDeleteAllData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        const query = buildQuery({
            chatId: input.chatId,
            chatType: input.chatType,
            isClearFromViewMessageDialog: input.isClearFromViewMessageDialog,
        });
        await client.request<unknown>(ENDPOINTS.chatMessages(input.chatflowId), {
            method: 'DELETE',
            query,
        });
        return { ok: true as const };
    });
}
