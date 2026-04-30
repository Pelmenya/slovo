import { z } from 'zod';
import { getFlowiseClient } from '../api/client';
import { ENDPOINTS } from '../api/endpoints';
import { formatErrorForMcp } from '../utils/errors';
import type { TFlowiseChatMessage } from '../api/t-flowise';
import type { TToolResult } from './t-tool';

// =============================================================================
// chatmessage_list  (GET /api/v1/chatmessage/:chatflowId)
// =============================================================================

export const chatmessageListSchema = z.object({
    chatflowId: z.string().min(1),
    chatId: z.string().optional().describe('Фильтр по конкретной сессии'),
    chatType: z.enum(['EXTERNAL', 'INTERNAL']).optional(),
    sortOrder: z.enum(['ASC', 'DESC']).optional().default('DESC'),
    limit: z.number().int().min(1).max(500).optional(),
});
export type TChatmessageListInput = z.infer<typeof chatmessageListSchema>;

export type TChatmessageListData = {
    count: number;
    messages: TFlowiseChatMessage[];
};

export async function chatmessageListHandler(
    input: TChatmessageListInput,
): Promise<TToolResult<TChatmessageListData>> {
    try {
        const client = getFlowiseClient();
        const query: Record<string, string | number | boolean | undefined> = {
            chatId: input.chatId,
            chatType: input.chatType,
            sortOrder: input.sortOrder,
            limit: input.limit,
        };
        const list = await client.request<TFlowiseChatMessage[]>(
            ENDPOINTS.chatMessages(input.chatflowId),
            { query },
        );
        return { success: true, data: { count: list.length, messages: list } };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
}
