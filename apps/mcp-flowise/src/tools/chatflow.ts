import { z } from 'zod';
import { getFlowiseClient } from '../config';
import { ENDPOINTS } from '@slovo/flowise-client';
import type { TFlowiseChatflow } from '@slovo/flowise-client';
import { withErrorHandling } from './_helpers';
import type { TToolResult } from './t-tool';

// =============================================================================
// Shared mappers
// =============================================================================

export type TChatflowListItem = {
    id: string;
    name: string;
    type: string;
    deployed: boolean;
    isPublic: boolean;
    category: string | null;
    updatedDate?: string;
};

function toListItem(c: TFlowiseChatflow): TChatflowListItem {
    return {
        id: c.id,
        name: c.name,
        type: c.type ?? 'CHATFLOW',
        deployed: Boolean(c.deployed),
        isPublic: Boolean(c.isPublic),
        category: c.category ?? null,
        updatedDate: c.updatedDate,
    };
}

// =============================================================================
// chatflow_list
// =============================================================================

export const chatflowListSchema = z.object({
    type: z
        .enum(['CHATFLOW', 'AGENTFLOW', 'MULTIAGENT', 'ASSISTANT'])
        .optional()
        .describe('Фильтр по типу chatflow'),
});
export type TChatflowListInput = z.infer<typeof chatflowListSchema>;

export type TChatflowListData = {
    count: number;
    chatflows: TChatflowListItem[];
};

export async function chatflowListHandler(
    input: TChatflowListInput,
): Promise<TToolResult<TChatflowListData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        const list = await client.request<TFlowiseChatflow[]>(ENDPOINTS.chatflows);
        const filtered = input.type ? list.filter((c) => c.type === input.type) : list;
        return { count: filtered.length, chatflows: filtered.map(toListItem) };
    });
}

// =============================================================================
// chatflow_get
// =============================================================================

export const chatflowGetSchema = z.object({
    chatflowId: z.string().min(1).describe('ID chatflow (uuid)'),
    includeFlowData: z
        .boolean()
        .optional()
        .describe('Включить flowData JSON (большой) — по умолчанию false для краткости'),
});
export type TChatflowGetInput = z.infer<typeof chatflowGetSchema>;

export type TChatflowGetData = {
    id: string;
    name: string;
    type: string;
    deployed: boolean;
    isPublic: boolean;
    category: string | null;
    flowData?: string;
    chatbotConfig: string | null;
    apiConfig: string | null;
    speechToText: string | null;
    followUpPrompts: string | null;
    apikeyid?: string;
    createdDate?: string;
    updatedDate?: string;
};

export async function chatflowGetHandler(
    input: TChatflowGetInput,
): Promise<TToolResult<TChatflowGetData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        const cf = await client.request<TFlowiseChatflow>(ENDPOINTS.chatflowById(input.chatflowId));
        const data: TChatflowGetData = {
            id: cf.id,
            name: cf.name,
            type: cf.type ?? 'CHATFLOW',
            deployed: Boolean(cf.deployed),
            isPublic: Boolean(cf.isPublic),
            category: cf.category ?? null,
            chatbotConfig: cf.chatbotConfig ?? null,
            apiConfig: cf.apiConfig ?? null,
            speechToText: cf.speechToText ?? null,
            followUpPrompts: cf.followUpPrompts ?? null,
            apikeyid: cf.apikeyid,
            createdDate: cf.createdDate,
            updatedDate: cf.updatedDate,
        };
        if (input.includeFlowData) {
            data.flowData = cf.flowData;
        }
        return data;
    });
}

// =============================================================================
// chatflow_get_by_apikey
// =============================================================================

export const chatflowGetByApiKeySchema = z.object({
    apikey: z.string().min(1).describe('Flowise API key (НЕ apikey id, само значение)'),
});
export type TChatflowGetByApiKeyInput = z.infer<typeof chatflowGetByApiKeySchema>;

export type TChatflowGetByApiKeyData = {
    count: number;
    chatflows: TChatflowListItem[];
};

export async function chatflowGetByApiKeyHandler(
    input: TChatflowGetByApiKeyInput,
): Promise<TToolResult<TChatflowGetByApiKeyData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        const list = await client.request<TFlowiseChatflow[]>(
            ENDPOINTS.chatflowByApiKey(input.apikey),
        );
        return { count: list.length, chatflows: list.map(toListItem) };
    });
}

// =============================================================================
// chatflow_create
// =============================================================================

export const chatflowCreateSchema = z.object({
    name: z.string().min(1),
    flowData: z.string().min(1).describe('JSON-сериализованная схема флоу (nodes + edges)'),
    deployed: z.boolean().optional(),
    isPublic: z.boolean().optional(),
    type: z.enum(['CHATFLOW', 'AGENTFLOW', 'MULTIAGENT', 'ASSISTANT']).optional(),
    category: z.string().optional(),
    chatbotConfig: z.string().optional(),
    apiConfig: z.string().optional(),
});
export type TChatflowCreateInput = z.infer<typeof chatflowCreateSchema>;

export type TChatflowCreateData = TFlowiseChatflow;

export async function chatflowCreateHandler(
    input: TChatflowCreateInput,
): Promise<TToolResult<TChatflowCreateData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        return client.request<TFlowiseChatflow>(ENDPOINTS.chatflows, {
            method: 'POST',
            body: input,
        });
    });
}

// =============================================================================
// chatflow_update
// =============================================================================

export const chatflowUpdateSchema = z.object({
    chatflowId: z.string().min(1),
    name: z.string().min(1).optional(),
    flowData: z.string().optional(),
    deployed: z.boolean().optional(),
    isPublic: z.boolean().optional(),
    category: z.string().optional(),
    chatbotConfig: z.string().optional(),
    apiConfig: z.string().optional(),
});
export type TChatflowUpdateInput = z.infer<typeof chatflowUpdateSchema>;

export type TChatflowUpdateData = TFlowiseChatflow;

export async function chatflowUpdateHandler(
    input: TChatflowUpdateInput,
): Promise<TToolResult<TChatflowUpdateData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        const { chatflowId, ...rest } = input;
        return client.request<TFlowiseChatflow>(ENDPOINTS.chatflowById(chatflowId), {
            method: 'PUT',
            body: rest,
        });
    });
}

// =============================================================================
// chatflow_delete
// =============================================================================

export const chatflowDeleteSchema = z.object({
    chatflowId: z.string().min(1),
});
export type TChatflowDeleteInput = z.infer<typeof chatflowDeleteSchema>;

export type TChatflowDeleteData = { ok: true };

export async function chatflowDeleteHandler(
    input: TChatflowDeleteInput,
): Promise<TToolResult<TChatflowDeleteData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        await client.request<unknown>(ENDPOINTS.chatflowById(input.chatflowId), {
            method: 'DELETE',
        });
        return { ok: true as const };
    });
}
