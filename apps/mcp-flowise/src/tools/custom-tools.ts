import { z } from 'zod';
import { getFlowiseClient } from '../api/client';
import { ENDPOINTS } from '../api/endpoints';
import { formatErrorForMcp } from '../utils/errors';
import type { TFlowiseCustomTool } from '../api/t-flowise';
import type { TToolResult } from './t-tool';

// =============================================================================
// custom_tools_list
// =============================================================================

export const customToolsListSchema = z.object({});
export type TCustomToolsListInput = z.infer<typeof customToolsListSchema>;

export type TCustomToolsListData = {
    count: number;
    tools: Array<Pick<TFlowiseCustomTool, 'id' | 'name' | 'description'>>;
};

export async function customToolsListHandler(
    _input: TCustomToolsListInput,
): Promise<TToolResult<TCustomToolsListData>> {
    try {
        const client = getFlowiseClient();
        const list = await client.request<TFlowiseCustomTool[]>(ENDPOINTS.customTools);
        return {
            success: true,
            data: {
                count: list.length,
                tools: list.map((t) => ({ id: t.id, name: t.name, description: t.description })),
            },
        };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
}

// =============================================================================
// custom_tools_get
// =============================================================================

export const customToolsGetSchema = z.object({
    toolId: z.string().min(1),
});
export type TCustomToolsGetInput = z.infer<typeof customToolsGetSchema>;

export type TCustomToolsGetData = TFlowiseCustomTool;

export async function customToolsGetHandler(
    input: TCustomToolsGetInput,
): Promise<TToolResult<TCustomToolsGetData>> {
    try {
        const client = getFlowiseClient();
        const tool = await client.request<TFlowiseCustomTool>(ENDPOINTS.customToolById(input.toolId));
        return { success: true, data: tool };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
}

// =============================================================================
// custom_tools_create
// =============================================================================

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
    try {
        const client = getFlowiseClient();
        const result = await client.request<TFlowiseCustomTool>(ENDPOINTS.customTools, {
            method: 'POST',
            body: input,
        });
        return { success: true, data: result };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
}

// =============================================================================
// custom_tools_update
// =============================================================================

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
    try {
        const client = getFlowiseClient();
        const { toolId, ...rest } = input;
        const result = await client.request<TFlowiseCustomTool>(ENDPOINTS.customToolById(toolId), {
            method: 'PUT',
            body: rest,
        });
        return { success: true, data: result };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
}

// =============================================================================
// custom_tools_delete
// =============================================================================

export const customToolsDeleteSchema = z.object({
    toolId: z.string().min(1),
});
export type TCustomToolsDeleteInput = z.infer<typeof customToolsDeleteSchema>;

export type TCustomToolsDeleteData = { ok: true };

export async function customToolsDeleteHandler(
    input: TCustomToolsDeleteInput,
): Promise<TToolResult<TCustomToolsDeleteData>> {
    try {
        const client = getFlowiseClient();
        await client.request<unknown>(ENDPOINTS.customToolById(input.toolId), { method: 'DELETE' });
        return { success: true, data: { ok: true } };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
}
