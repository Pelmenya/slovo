import { z } from 'zod';
import { getFlowiseClient } from '../api/client';
import { ENDPOINTS } from '../api/endpoints';
import { formatErrorForMcp } from '../utils/errors';
import type { TFlowiseUpsertHistory } from '../api/t-flowise';
import type { TToolResult } from './t-tool';

// =============================================================================
// upsert_history_list  (GET /api/v1/upsert-history/:chatflowId)
// =============================================================================

export const upsertHistoryListSchema = z.object({
    chatflowId: z.string().min(1),
    sortOrder: z.enum(['ASC', 'DESC']).optional().default('DESC'),
    limit: z.number().int().min(1).max(500).optional(),
});
export type TUpsertHistoryListInput = z.infer<typeof upsertHistoryListSchema>;

export type TUpsertHistoryListData = {
    count: number;
    history: TFlowiseUpsertHistory[];
};

export async function upsertHistoryListHandler(
    input: TUpsertHistoryListInput,
): Promise<TToolResult<TUpsertHistoryListData>> {
    try {
        const client = getFlowiseClient();
        const query: Record<string, string | number | boolean | undefined> = {
            sortOrder: input.sortOrder,
            limit: input.limit,
        };
        const list = await client.request<TFlowiseUpsertHistory[]>(
            ENDPOINTS.upsertHistory(input.chatflowId),
            { query },
        );
        return { success: true, data: { count: list.length, history: list } };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
}
