import { z } from 'zod';
import { getFlowiseClient } from '../api/client';
import { ENDPOINTS } from '../api/endpoints';
import type { TFlowiseVariable } from '../api/t-flowise';
import { withErrorHandling } from './_helpers';
import type { TToolResult } from './t-tool';

export const variablesListSchema = z.object({});
export type TVariablesListInput = z.infer<typeof variablesListSchema>;

export type TVariablesListData = {
    count: number;
    variables: TFlowiseVariable[];
};

export async function variablesListHandler(
    _input: TVariablesListInput,
): Promise<TToolResult<TVariablesListData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        const list = await client.request<TFlowiseVariable[]>(ENDPOINTS.variables);
        return { count: list.length, variables: list };
    });
}

export const variablesCreateSchema = z.object({
    name: z.string().min(1),
    value: z.string(),
    type: z.enum(['static', 'runtime']).optional(),
});
export type TVariablesCreateInput = z.infer<typeof variablesCreateSchema>;
export type TVariablesCreateData = TFlowiseVariable;

export async function variablesCreateHandler(
    input: TVariablesCreateInput,
): Promise<TToolResult<TVariablesCreateData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        return client.request<TFlowiseVariable>(ENDPOINTS.variables, { method: 'POST', body: input });
    });
}

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
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        const { variableId, ...rest } = input;
        return client.request<TFlowiseVariable>(ENDPOINTS.variableById(variableId), {
            method: 'PUT',
            body: rest,
        });
    });
}

export const variablesDeleteSchema = z.object({
    variableId: z.string().min(1),
});
export type TVariablesDeleteInput = z.infer<typeof variablesDeleteSchema>;
export type TVariablesDeleteData = { ok: true };

export async function variablesDeleteHandler(
    input: TVariablesDeleteInput,
): Promise<TToolResult<TVariablesDeleteData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        await client.request<unknown>(ENDPOINTS.variableById(input.variableId), {
            method: 'DELETE',
        });
        return { ok: true as const };
    });
}
