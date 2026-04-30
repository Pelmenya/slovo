import { credentialsListHandler, credentialsListSchema } from './credentials';
import { docstoreListHandler, docstoreListSchema, docstoreQueryHandler, docstoreQuerySchema } from './docstore';
import { pingHandler, pingSchema } from './ping';
import type { TToolDefinition } from './t-tool';

export const tools: Record<string, TToolDefinition> = {
    flowise_ping: {
        description: 'Health-check Flowise через GET /api/v1/ping. Проверяет связь и валидность API key.',
        schema: pingSchema,
        handler: pingHandler as TToolDefinition['handler'],
    },
    flowise_credentials_list: {
        description:
            'Список Flowise credentials с id и типом. Используется для discovery credentialId перед docstore_create / chatflow_create. Опциональный фильтр по credentialName.',
        schema: credentialsListSchema,
        handler: credentialsListHandler as TToolDefinition['handler'],
    },
    flowise_docstore_list: {
        description:
            'Список Document Stores в Flowise. Возвращает id, name, status, totalChunks, hasEmbedding, hasVectorStore — компактная сводка без деталей loader-ов.',
        schema: docstoreListSchema,
        handler: docstoreListHandler as TToolDefinition['handler'],
    },
    flowise_docstore_query: {
        description:
            'Retrieval-search в Document Store без LLM-overlay (POST /api/v1/document-store/vectorstore/query). Возвращает top-K релевантных чанков с metadata. ~150-500ms vs ~1500-5000ms для эквивалентного Chatflow + LLM.',
        schema: docstoreQuerySchema,
        handler: docstoreQueryHandler as TToolDefinition['handler'],
    },
};

export type TToolName = keyof typeof tools;
