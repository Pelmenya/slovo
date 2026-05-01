import { z } from 'zod';
import { getFlowiseClient } from '../config';
import { ENDPOINTS } from '@slovo/flowise-client';
import type { TFlowiseCustomTool } from '@slovo/flowise-client';
import { withErrorHandling } from './_helpers';
import type { TToolResult } from './t-tool';

export const customToolsListSchema = z.object({});
export type TCustomToolsListInput = z.infer<typeof customToolsListSchema>;

export type TCustomToolsListData = {
    count: number;
    tools: Array<Pick<TFlowiseCustomTool, 'id' | 'name' | 'description'>>;
};

export async function customToolsListHandler(
    _input: TCustomToolsListInput,
): Promise<TToolResult<TCustomToolsListData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        const list = await client.request<TFlowiseCustomTool[]>(ENDPOINTS.customTools);
        return {
            count: list.length,
            tools: list.map((t) => ({ id: t.id, name: t.name, description: t.description })),
        };
    });
}

export const customToolsGetSchema = z.object({
    toolId: z.string().min(1),
});
export type TCustomToolsGetInput = z.infer<typeof customToolsGetSchema>;
export type TCustomToolsGetData = TFlowiseCustomTool;

export async function customToolsGetHandler(
    input: TCustomToolsGetInput,
): Promise<TToolResult<TCustomToolsGetData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        return client.request<TFlowiseCustomTool>(ENDPOINTS.customToolById(input.toolId));
    });
}

export const customToolsCreateSchema = z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    color: z.string().optional(),
    iconSrc: z.string().optional(),
    schema: z.string().optional().describe('JSON schema arguments tool'),
    func: z.string().optional().describe('JS-функция тела tool (str)'),
});
export type TCustomToolsCreateInput = z.infer<typeof customToolsCreateSchema>;
export type TCustomToolsCreateData = TFlowiseCustomTool;

export async function customToolsCreateHandler(
    input: TCustomToolsCreateInput,
): Promise<TToolResult<TCustomToolsCreateData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        return client.request<TFlowiseCustomTool>(ENDPOINTS.customTools, {
            method: 'POST',
            body: input,
        });
    });
}

export const customToolsUpdateSchema = z.object({
    toolId: z.string().min(1),
    name: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    color: z.string().optional(),
    iconSrc: z.string().optional(),
    schema: z.string().optional(),
    func: z.string().optional(),
});
export type TCustomToolsUpdateInput = z.infer<typeof customToolsUpdateSchema>;
export type TCustomToolsUpdateData = TFlowiseCustomTool;

export async function customToolsUpdateHandler(
    input: TCustomToolsUpdateInput,
): Promise<TToolResult<TCustomToolsUpdateData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        const { toolId, ...rest } = input;
        return client.request<TFlowiseCustomTool>(ENDPOINTS.customToolById(toolId), {
            method: 'PUT',
            body: rest,
        });
    });
}

export const customToolsDeleteSchema = z.object({
    toolId: z.string().min(1),
});
export type TCustomToolsDeleteInput = z.infer<typeof customToolsDeleteSchema>;
export type TCustomToolsDeleteData = { ok: true };

export async function customToolsDeleteHandler(
    input: TCustomToolsDeleteInput,
): Promise<TToolResult<TCustomToolsDeleteData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        await client.request<unknown>(ENDPOINTS.customToolById(input.toolId), { method: 'DELETE' });
        return { ok: true as const };
    });
}
