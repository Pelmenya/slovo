import {
    credentialsListHandler,
    credentialsListSchema,
    type TCredentialsListData,
    type TCredentialsListInput,
} from './credentials';
import {
    docstoreListHandler,
    docstoreListSchema,
    docstoreQueryHandler,
    docstoreQuerySchema,
    type TDocstoreListData,
    type TDocstoreListInput,
    type TDocstoreQueryData,
    type TDocstoreQueryInput,
} from './docstore';
import { pingHandler, pingSchema, type TPingData, type TPingInput } from './ping';
import type { TToolDefinition } from './t-tool';

export const tools = {
    flowise_ping: {
        description: 'Health-check Flowise через GET /api/v1/ping. Проверяет связь и валидность API key.',
        schema: pingSchema,
        handler: pingHandler,
    } satisfies TToolDefinition<TPingInput, TPingData>,
    flowise_credentials_list: {
        description:
            'Список Flowise credentials с id и типом. Используется для discovery credentialId перед docstore_create / chatflow_create. Опциональный фильтр по credentialName.',
        schema: credentialsListSchema,
        handler: credentialsListHandler,
    } satisfies TToolDefinition<TCredentialsListInput, TCredentialsListData>,
    flowise_docstore_list: {
        description:
            'Список Document Stores в Flowise. Возвращает id, name, status, totalChunks, hasEmbedding, hasVectorStore — компактная сводка без деталей loader-ов.',
        schema: docstoreListSchema,
        handler: docstoreListHandler,
    } satisfies TToolDefinition<TDocstoreListInput, TDocstoreListData>,
    flowise_docstore_query: {
        description:
            'Retrieval-search в Document Store без LLM-overlay (POST /api/v1/document-store/vectorstore/query). Возвращает top-K релевантных чанков с metadata. ~150-500ms vs ~1500-5000ms для эквивалентного Chatflow + LLM.',
        schema: docstoreQuerySchema,
        handler: docstoreQueryHandler,
    } satisfies TToolDefinition<TDocstoreQueryInput, TDocstoreQueryData>,
} as const;
