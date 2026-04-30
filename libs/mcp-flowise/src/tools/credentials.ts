import { z } from 'zod';
import { getFlowiseClient } from '../api/client';
import { ENDPOINTS } from '../api/endpoints';
import { formatErrorForMcp } from '../utils/errors';
import type { TFlowiseCredential } from '../api/t-flowise';
import type { TToolResult } from './t-tool';

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
    try {
        const client = getFlowiseClient();
        const list = await client.request<TFlowiseCredential[]>(ENDPOINTS.credentials);
        const filtered = input.credentialName
            ? list.filter((c) => c.credentialName === input.credentialName)
            : list;

        return {
            success: true,
            data: {
                count: filtered.length,
                credentials: filtered.map((c) => ({
                    id: c.id,
                    name: c.name,
                    credentialName: c.credentialName,
                })),
            },
        };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
}
