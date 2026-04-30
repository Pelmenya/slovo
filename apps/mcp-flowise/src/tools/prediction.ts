import { z } from 'zod';
import { getFlowiseClient } from '../api/client';
import { ENDPOINTS } from '../api/endpoints';
import { formatErrorForMcp } from '../utils/errors';
import type { TFlowisePredictionResponse } from '../api/t-flowise';
import type { TToolResult } from './t-tool';

// =============================================================================
// prediction_run  (POST /api/v1/prediction/:chatflowId)
// =============================================================================

const uploadSchema = z.object({
    data: z
        .string()
        .min(1)
        .describe('data:<mime>;base64,<base64-data> для file/audio, или URL для type=url'),
    type: z.enum(['file', 'url', 'audio']),
    name: z.string().min(1).describe('Имя файла (например, "image.png")'),
    mime: z.string().min(1).describe('MIME-type ("image/png", "audio/wav", ...)'),
});

const historyMessageSchema = z.object({
    role: z.enum(['apiMessage', 'userMessage']),
    content: z.string(),
});

export const predictionRunSchema = z.object({
    chatflowId: z.string().min(1).describe('ID Chatflow для запуска prediction'),
    question: z.string().optional().describe('Текст вопроса (для CHATFLOW / Conversational Retrieval QA Chain)'),
    form: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Form-данные для AgentFlow V2 (если флоу с Start Node form input)'),
    overrideConfig: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Override конфигурации нод (promptValues, sessionId, returnSourceDocuments и т.д.)'),
    history: z.array(historyMessageSchema).optional().describe('История диалога для multi-turn'),
    uploads: z
        .array(uploadSchema)
        .optional()
        .describe('Изображения / аудио / файлы для vision/audio chatflows (base64-кодированные)'),
    chatId: z.string().optional().describe('ID сессии (для conversation memory)'),
    streaming: z.boolean().optional().describe('Включить SSE streaming (для MCP не используется — false)'),
    leadEmail: z.string().email().optional().describe('Email для lead capture'),
});
export type TPredictionRunInput = z.infer<typeof predictionRunSchema>;

export type TPredictionRunData = TFlowisePredictionResponse & {
    elapsedMs: number;
};

export async function predictionRunHandler(
    input: TPredictionRunInput,
): Promise<TToolResult<TPredictionRunData>> {
    try {
        const client = getFlowiseClient();
        const { chatflowId, ...body } = input;
        const start = Date.now();
        const response = await client.request<TFlowisePredictionResponse>(
            ENDPOINTS.prediction(chatflowId),
            { method: 'POST', body },
        );
        return {
            success: true,
            data: { ...response, elapsedMs: Date.now() - start },
        };
    } catch (error) {
        return { success: false, error: formatErrorForMcp(error) };
    }
}
