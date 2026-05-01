import { z } from 'zod';
import { getFlowiseClient } from '../config';
import { ENDPOINTS } from '@slovo/flowise-client';
import type { TFlowiseAssistant } from '@slovo/flowise-client';
import { withErrorHandling } from './_helpers';
import type { TToolResult } from './t-tool';

// =============================================================================
// assistants_list — Pick без details (может быть большой JSON со всеми instructions/tools)
// =============================================================================

export const assistantsListSchema = z.object({
    type: z.enum(['OPENAI', 'AZURE', 'CUSTOM']).optional(),
});
export type TAssistantsListInput = z.infer<typeof assistantsListSchema>;

export type TAssistantsListItem = Pick<TFlowiseAssistant, 'id' | 'type' | 'iconSrc' | 'updatedDate'>;

export type TAssistantsListData = {
    count: number;
    assistants: TAssistantsListItem[];
};

export async function assistantsListHandler(
    input: TAssistantsListInput,
): Promise<TToolResult<TAssistantsListData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        const list = await client.request<TFlowiseAssistant[]>(ENDPOINTS.assistants);
        const filtered = input.type ? list.filter((a) => a.type === input.type) : list;
        return {
            count: filtered.length,
            assistants: filtered.map((a) => ({
                id: a.id,
                type: a.type,
                iconSrc: a.iconSrc,
                updatedDate: a.updatedDate,
            })),
        };
    });
}

// =============================================================================
// assistants_get
// =============================================================================

export const assistantsGetSchema = z.object({
    assistantId: z.string().min(1),
});
export type TAssistantsGetInput = z.infer<typeof assistantsGetSchema>;
export type TAssistantsGetData = TFlowiseAssistant;

export async function assistantsGetHandler(
    input: TAssistantsGetInput,
): Promise<TToolResult<TAssistantsGetData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        return client.request<TFlowiseAssistant>(ENDPOINTS.assistantById(input.assistantId));
    });
}

// =============================================================================
// assistants_create
// =============================================================================

export const assistantsCreateSchema = z.object({
    details: z.string().min(1).describe('JSON-сериализованные детали ассистента (instructions, model, tools, ...)'),
    credential: z.string().optional().describe('credentialId для OPENAI/AZURE'),
    iconSrc: z.string().optional(),
    type: z.enum(['OPENAI', 'AZURE', 'CUSTOM']).optional(),
});
export type TAssistantsCreateInput = z.infer<typeof assistantsCreateSchema>;
export type TAssistantsCreateData = TFlowiseAssistant;

export async function assistantsCreateHandler(
    input: TAssistantsCreateInput,
): Promise<TToolResult<TAssistantsCreateData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        return client.request<TFlowiseAssistant>(ENDPOINTS.assistants, {
            method: 'POST',
            body: input,
        });
    });
}

// =============================================================================
// assistants_update
// =============================================================================

export const assistantsUpdateSchema = z.object({
    assistantId: z.string().min(1),
    details: z.string().min(1).optional(),
    credential: z.string().optional(),
    iconSrc: z.string().optional(),
});
export type TAssistantsUpdateInput = z.infer<typeof assistantsUpdateSchema>;
export type TAssistantsUpdateData = TFlowiseAssistant;

export async function assistantsUpdateHandler(
    input: TAssistantsUpdateInput,
): Promise<TToolResult<TAssistantsUpdateData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        const { assistantId, ...rest } = input;
        return client.request<TFlowiseAssistant>(ENDPOINTS.assistantById(assistantId), {
            method: 'PUT',
            body: rest,
        });
    });
}

// =============================================================================
// assistants_delete
// =============================================================================

export const assistantsDeleteSchema = z.object({
    assistantId: z.string().min(1),
});
export type TAssistantsDeleteInput = z.infer<typeof assistantsDeleteSchema>;
export type TAssistantsDeleteData = { ok: true };

export async function assistantsDeleteHandler(
    input: TAssistantsDeleteInput,
): Promise<TToolResult<TAssistantsDeleteData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        await client.request<unknown>(ENDPOINTS.assistantById(input.assistantId), {
            method: 'DELETE',
        });
        return { ok: true as const };
    });
}
