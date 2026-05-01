import { z } from 'zod';
import { getFlowiseClient } from '../config';
import { ENDPOINTS } from '@slovo/flowise-client';
import { withErrorHandling } from './_helpers';
import type { TToolResult } from './t-tool';

export const pingSchema = z.object({});

export type TPingInput = z.infer<typeof pingSchema>;

export type TPingData = {
    ok: true;
    response: unknown;
    elapsedMs: number;
};

export async function pingHandler(_input: TPingInput): Promise<TToolResult<TPingData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        const start = Date.now();
        const response = await client.request<unknown>(ENDPOINTS.ping);
        return { ok: true as const, response, elapsedMs: Date.now() - start };
    });
}
