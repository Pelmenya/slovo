import { z } from 'zod';
import { getFlowiseClient } from '../api/client';
import { ENDPOINTS } from '../api/endpoints';
import { formatErrorForMcp } from '../utils/errors';
import type { TFlowiseVariable } from '../api/t-flowise';
import type { TToolResult } from './t-tool';

// =============================================================================
// variables_list
// =============================================================================

export const variablesListSchema = z.object({});
export type TVariablesListInput = z.infer<typeof variablesListSchema>;

export type TVariablesListData = {
    count: number;
    variables: TFlowiseVariable[];
};

export async function variablesListHandler(
    _input: TVariablesListInput,
): Promise<TToolResult<TVariablesListData>> {
    try {
        const client = getFlowiseClient();
        const list = await client.request<TFlowiseVariable[]>(ENDPOINTS.variables);
        return { success: true, data: { count: list.length, variables: list } };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
}

// =============================================================================
// variables_create
// =============================================================================

export const variablesCreateSchema = z.object({
    name: z.string().min(1),
    value: z.string(),
    type: z.enum(['static', 'runtime']).default('static'),
});
export type TVariablesCreateInput = z.infer<typeof variablesCreateSchema>;

export type TVariablesCreateData = TFlowiseVariable;

export async function variablesCreateHandler(
    input: TVariablesCreateInput,
): Promise<TToolResult<TVariablesCreateData>> {
    try {
        const client = getFlowiseClient();
        const result = await client.request<TFlowiseVariable>(ENDPOINTS.variables, {
            method: 'POST',
            body: input,
        });
        return { success: true, data: result };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
}

// =============================================================================
// variables_update
// =============================================================================

export const variablesUpdateSchema = z.object({
    variableId: z.string().min(1),
    name: z.string().min(1).optional(),
    value: z.string().optional(),
    type: z.enum(['static', 'runtime']).optional(),
});
export type TVariablesUpdateInput = z.infer<typeof variablesUpdateSchema>;

export type TVariablesUpdateData = TFlowiseVariable;

export async function variablesUpdateHandler(
    input: TVariablesUpdateInput,
): Promise<TToolResult<TVariablesUpdateData>> {
    try {
        const client = getFlowiseClient();
        const { variableId, ...rest } = input;
        const result = await client.request<TFlowiseVariable>(ENDPOINTS.variableById(variableId), {
            method: 'PUT',
            body: rest,
        });
        return { success: true, data: result };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
}

// =============================================================================
// variables_delete
// =============================================================================

export const variablesDeleteSchema = z.object({
    variableId: z.string().min(1),
});
export type TVariablesDeleteInput = z.infer<typeof variablesDeleteSchema>;

export type TVariablesDeleteData = { ok: true };

export async function variablesDeleteHandler(
    input: TVariablesDeleteInput,
): Promise<TToolResult<TVariablesDeleteData>> {
    try {
        const client = getFlowiseClient();
        await client.request<unknown>(ENDPOINTS.variableById(input.variableId), {
            method: 'DELETE',
        });
        return { success: true, data: { ok: true } };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
}
