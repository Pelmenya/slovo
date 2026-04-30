import { z } from 'zod';
import { getFlowiseClient } from '../api/client';
import { ENDPOINTS } from '../api/endpoints';
import { formatErrorForMcp } from '../utils/errors';
import type { TFlowiseAssistant } from '../api/t-flowise';
import type { TToolResult } from './t-tool';

// =============================================================================
// assistants_list
// =============================================================================

export const assistantsListSchema = z.object({
    type: z.enum(['OPENAI', 'AZURE', 'CUSTOM']).optional(),
});
export type TAssistantsListInput = z.infer<typeof assistantsListSchema>;

export type TAssistantsListData = {
    count: number;
    assistants: TFlowiseAssistant[];
};

export async function assistantsListHandler(
    input: TAssistantsListInput,
): Promise<TToolResult<TAssistantsListData>> {
    try {
        const client = getFlowiseClient();
        const list = await client.request<TFlowiseAssistant[]>(ENDPOINTS.assistants);
        const filtered = input.type ? list.filter((a) => a.type === input.type) : list;
        return { success: true, data: { count: filtered.length, assistants: filtered } };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
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
    try {
        const client = getFlowiseClient();
        const assistant = await client.request<TFlowiseAssistant>(
            ENDPOINTS.assistantById(input.assistantId),
        );
        return { success: true, data: assistant };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
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
    try {
        const client = getFlowiseClient();
        const result = await client.request<TFlowiseAssistant>(ENDPOINTS.assistants, {
            method: 'POST',
            body: input,
        });
        return { success: true, data: result };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
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
    try {
        const client = getFlowiseClient();
        const { assistantId, ...rest } = input;
        const result = await client.request<TFlowiseAssistant>(ENDPOINTS.assistantById(assistantId), {
            method: 'PUT',
            body: rest,
        });
        return { success: true, data: result };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
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
    try {
        const client = getFlowiseClient();
        await client.request<unknown>(ENDPOINTS.assistantById(input.assistantId), {
            method: 'DELETE',
        });
        return { success: true, data: { ok: true } };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
}
