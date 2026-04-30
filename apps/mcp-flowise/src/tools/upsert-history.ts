import { z } from 'zod';
import { getFlowiseClient } from '../api/client';
import { ENDPOINTS } from '../api/endpoints';
import type { TFlowiseUpsertHistory } from '../api/t-flowise';
import { buildQuery, withErrorHandling } from './_helpers';
import type { TToolResult } from './t-tool';

export const upsertHistoryListSchema = z.object({
    chatflowId: z.string().min(1),
    sortOrder: z.enum(['ASC', 'DESC']).optional(),
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
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        const query = buildQuery({ sortOrder: input.sortOrder, limit: input.limit });
        const list = await client.request<TFlowiseUpsertHistory[]>(
            ENDPOINTS.upsertHistory(input.chatflowId),
            { query },
        );
        return { count: list.length, history: list };
    });
}
