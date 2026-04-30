import { z } from 'zod';
import { getFlowiseClient } from '../api/client';
import { ENDPOINTS } from '../api/endpoints';
import type { TFlowiseCredential, TFlowiseCredentialDetail } from '../api/t-flowise';
import { withErrorHandling } from './_helpers';
import type { TToolResult } from './t-tool';

// =============================================================================
// credentials_list
// =============================================================================

export const credentialsListSchema = z.object({
    credentialName: z
        .string()
        .optional()
        .describe('Фильтр по типу: awsApi / openAIApi / anthropicApi / PostgresApi / ...'),
});
export type TCredentialsListInput = z.infer<typeof credentialsListSchema>;

export type TCredentialsListData = {
    count: number;
    credentials: Array<Pick<TFlowiseCredential, 'id' | 'name' | 'credentialName'>>;
};

export async function credentialsListHandler(
    input: TCredentialsListInput,
): Promise<TToolResult<TCredentialsListData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        const list = await client.request<TFlowiseCredential[]>(ENDPOINTS.credentials);
        const filtered = input.credentialName
            ? list.filter((c) => c.credentialName === input.credentialName)
            : list;
        return {
            count: filtered.length,
            credentials: filtered.map((c) => ({
                id: c.id,
                name: c.name,
                credentialName: c.credentialName,
            })),
        };
    });
}

// =============================================================================
// credentials_get
// =============================================================================

export const credentialsGetSchema = z.object({
    credentialId: z.string().min(1),
});
export type TCredentialsGetInput = z.infer<typeof credentialsGetSchema>;

export type TCredentialsGetData = TFlowiseCredentialDetail;

export async function credentialsGetHandler(
    input: TCredentialsGetInput,
): Promise<TToolResult<TCredentialsGetData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        return client.request<TFlowiseCredentialDetail>(ENDPOINTS.credentialById(input.credentialId));
    });
}

// =============================================================================
// credentials_create
// =============================================================================

export const credentialsCreateSchema = z.object({
    name: z.string().min(1).describe('Display name credential'),
    credentialName: z
        .string()
        .min(1)
        .describe('Тип credential (awsApi / openAIApi / anthropicApi / PostgresApi / ...)'),
    plainDataObj: z
        .record(z.string(), z.unknown())
        .describe('Plain data (например, { accessKeyId, secretAccessKey } для awsApi). Flowise зашифрует.'),
});
export type TCredentialsCreateInput = z.infer<typeof credentialsCreateSchema>;

export type TCredentialsCreateData = TFlowiseCredential;

export async function credentialsCreateHandler(
    input: TCredentialsCreateInput,
): Promise<TToolResult<TCredentialsCreateData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        return client.request<TFlowiseCredential>(ENDPOINTS.credentials, {
            method: 'POST',
            body: input,
        });
    });
}

// =============================================================================
// credentials_update
// =============================================================================

export const credentialsUpdateSchema = z.object({
    credentialId: z.string().min(1),
    name: z.string().min(1).optional(),
    plainDataObj: z.record(z.string(), z.unknown()).optional(),
});
export type TCredentialsUpdateInput = z.infer<typeof credentialsUpdateSchema>;

export type TCredentialsUpdateData = TFlowiseCredential;

export async function credentialsUpdateHandler(
    input: TCredentialsUpdateInput,
): Promise<TToolResult<TCredentialsUpdateData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        const { credentialId, ...rest } = input;
        return client.request<TFlowiseCredential>(ENDPOINTS.credentialById(credentialId), {
            method: 'PUT',
            body: rest,
        });
    });
}

// =============================================================================
// credentials_delete
// =============================================================================

export const credentialsDeleteSchema = z.object({
    credentialId: z.string().min(1),
});
export type TCredentialsDeleteInput = z.infer<typeof credentialsDeleteSchema>;

export type TCredentialsDeleteData = { ok: true };

export async function credentialsDeleteHandler(
    input: TCredentialsDeleteInput,
): Promise<TToolResult<TCredentialsDeleteData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        await client.request<unknown>(ENDPOINTS.credentialById(input.credentialId), {
            method: 'DELETE',
        });
        return { ok: true as const };
    });
}
