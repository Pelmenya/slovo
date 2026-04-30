import { z } from 'zod';
import { getFlowiseClient } from '../api/client';
import { ENDPOINTS } from '../api/endpoints';
import { withErrorHandling } from './_helpers';
import type { TToolResult } from './t-tool';

// =============================================================================
// attachments_create (POST /api/v1/attachments/:chatflowId)
//
// Загрузить attachment отдельно от prediction (для повторного использования
// или для подготовки больших файлов до самого prediction). Эквивалент
// uploads[] в predictionRun, но как отдельный шаг.
// =============================================================================

const attachmentSchema = z.object({
    name: z.string().min(1),
    type: z.enum(['file', 'url', 'audio']),
    data: z.string().min(1).describe('data:<mime>;base64,<base64-data> или URL'),
    mime: z.string().min(1),
});

export const attachmentsCreateSchema = z.object({
    chatflowId: z.string().min(1),
    chatId: z.string().min(1).describe('Сессия чата (для группировки attachments)'),
    files: z.array(attachmentSchema).min(1).describe('Список attachments для загрузки'),
});
export type TAttachmentsCreateInput = z.infer<typeof attachmentsCreateSchema>;

export type TAttachmentsCreateData = {
    uploads: Array<{
        name: string;
        type: string;
        mime: string;
        data?: string;
    }>;
    [key: string]: unknown;
};

export async function attachmentsCreateHandler(
    input: TAttachmentsCreateInput,
): Promise<TToolResult<TAttachmentsCreateData>> {
    return withErrorHandling(async () => {
        const client = getFlowiseClient();
        const { chatflowId, ...body } = input;
        return client.request<TAttachmentsCreateData>(ENDPOINTS.attachments(chatflowId), {
            method: 'POST',
            body,
        });
    });
}
