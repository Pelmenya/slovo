import { z } from 'zod';
import { getFlowiseClient } from '../config';
import { ENDPOINTS } from '@slovo/flowise-client';
import type { TFlowiseUpsertHistory } from '@slovo/flowise-client';
import { buildQuery, withErrorHandling } from './_helpers';
import type { TToolResult } from './t-tool';

// =============================================================================
// upsert_history_list
// =============================================================================

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

// =============================================================================
// upsert_history_patch_delete — soft-delete records
//
// PATCH /upsert-history с body { ids: [<historyId>, ...] } — soft-delete.
// =============================================================================

export const upsertHistoryPatchDeleteSchema = z.object({
    ids: z.array(z.string().min(1)).min(1).describe('Список historyId для soft-delete'),
});
export type TUpsertHistoryPatchDeleteInput = z.infer<typeof upsertHistoryPatchDeleteSchema>;

export type TUpsertHistoryPatchDeleteData = { ok: true };

export async function upsertHistoryPatchDeleteHandler(
    input: TUpsertHistoryPatchDeleteInput,
): Promise<TToolResult<TUpsertHistoryPatchDeleteData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        await client.request<unknown>(ENDPOINTS.upsertHistoryRoot, {
            method: 'PATCH',
            body: { ids: input.ids },
        });
        return { ok: true as const };
    });
}
