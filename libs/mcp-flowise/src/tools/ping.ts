import { z } from 'zod';
import { getFlowiseClient } from '../api/client';
import { ENDPOINTS } from '../api/endpoints';
import { formatErrorForMcp } from '../utils/errors';
import type { TToolResult } from './t-tool';

export const pingSchema = z.object({});

export type TPingInput = z.infer<typeof pingSchema>;

export type TPingData = {
    ok: true;
    response: unknown;
    elapsedMs: number;
};

export async function pingHandler(_input: TPingInput): Promise<TToolResult<TPingData>> {
    try {
        const client = getFlowiseClient();
        const start = Date.now();
        const response = await client.request<unknown>(ENDPOINTS.ping);
        return {
            success: true,
            data: {
                ok: true,
                response,
                elapsedMs: Date.now() - start,
            },
        };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
}
