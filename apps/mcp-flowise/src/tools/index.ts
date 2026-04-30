import {
    assistantsCreateHandler,
    assistantsCreateSchema,
    assistantsDeleteHandler,
    assistantsDeleteSchema,
    assistantsGetHandler,
    assistantsGetSchema,
    assistantsListHandler,
    assistantsListSchema,
    assistantsUpdateHandler,
    assistantsUpdateSchema,
    type TAssistantsCreateData,
    type TAssistantsCreateInput,
    type TAssistantsDeleteData,
    type TAssistantsDeleteInput,
    type TAssistantsGetData,
    type TAssistantsGetInput,
    type TAssistantsListData,
    type TAssistantsListInput,
    type TAssistantsUpdateData,
    type TAssistantsUpdateInput,
} from './assistants';
import {
    chatflowCreateHandler,
    chatflowCreateSchema,
    chatflowDeleteHandler,
    chatflowDeleteSchema,
    chatflowGetByApiKeyHandler,
    chatflowGetByApiKeySchema,
    chatflowGetHandler,
    chatflowGetSchema,
    chatflowListHandler,
    chatflowListSchema,
    chatflowUpdateHandler,
    chatflowUpdateSchema,
    type TChatflowCreateData,
    type TChatflowCreateInput,
    type TChatflowDeleteData,
    type TChatflowDeleteInput,
    type TChatflowGetByApiKeyData,
    type TChatflowGetByApiKeyInput,
    type TChatflowGetData,
    type TChatflowGetInput,
    type TChatflowListData,
    type TChatflowListInput,
    type TChatflowUpdateData,
    type TChatflowUpdateInput,
} from './chatflow';
import {
    chatmessageListHandler,
    chatmessageListSchema,
    type TChatmessageListData,
    type TChatmessageListInput,
} from './chatmessage';
import {
    credentialsCreateHandler,
    credentialsCreateSchema,
    credentialsDeleteHandler,
    credentialsDeleteSchema,
    credentialsGetHandler,
    credentialsGetSchema,
    credentialsListHandler,
    credentialsListSchema,
    credentialsUpdateHandler,
    credentialsUpdateSchema,
    type TCredentialsCreateData,
    type TCredentialsCreateInput,
    type TCredentialsDeleteData,
    type TCredentialsDeleteInput,
    type TCredentialsGetData,
    type TCredentialsGetInput,
    type TCredentialsListData,
    type TCredentialsListInput,
    type TCredentialsUpdateData,
    type TCredentialsUpdateInput,
} from './credentials';
import {
    customToolsCreateHandler,
    customToolsCreateSchema,
    customToolsDeleteHandler,
    customToolsDeleteSchema,
    customToolsGetHandler,
    customToolsGetSchema,
    customToolsListHandler,
    customToolsListSchema,
    customToolsUpdateHandler,
    customToolsUpdateSchema,
    type TCustomToolsCreateData,
    type TCustomToolsCreateInput,
    type TCustomToolsDeleteData,
    type TCustomToolsDeleteInput,
    type TCustomToolsGetData,
    type TCustomToolsGetInput,
    type TCustomToolsListData,
    type TCustomToolsListInput,
    type TCustomToolsUpdateData,
    type TCustomToolsUpdateInput,
} from './custom-tools';
import {
    docstoreChunkDeleteHandler,
    docstoreChunkDeleteSchema,
    docstoreChunksListHandler,
    docstoreChunksListSchema,
    docstoreChunkUpdateHandler,
    docstoreChunkUpdateSchema,
    docstoreComponentsEmbeddingsHandler,
    docstoreComponentsLoadersHandler,
    docstoreComponentsRecordManagerHandler,
    docstoreComponentsSchema,
    docstoreComponentsVectorstoreHandler,
    docstoreCreateHandler,
    docstoreCreateSchema,
    docstoreDeleteHandler,
    docstoreDeleteSchema,
    docstoreGetHandler,
    docstoreGetSchema,
    docstoreListHandler,
    docstoreListSchema,
    docstoreLoaderDeleteHandler,
    docstoreLoaderDeleteSchema,
    docstoreLoaderPreviewHandler,
    docstoreLoaderPreviewSchema,
    docstoreLoaderProcessHandler,
    docstoreLoaderProcessSchema,
    docstoreLoaderSaveHandler,
    docstoreLoaderSaveSchema,
    docstoreQueryHandler,
    docstoreQuerySchema,
    docstoreRefreshHandler,
    docstoreRefreshSchema,
    docstoreUpdateHandler,
    docstoreUpdateSchema,
    docstoreUpsertHandler,
    docstoreUpsertSchema,
    docstoreVectorstoreDeleteHandler,
    docstoreVectorstoreDeleteSchema,
    docstoreVectorstoreInsertHandler,
    docstoreVectorstoreInsertSchema,
    docstoreVectorstoreSaveHandler,
    docstoreVectorstoreSaveSchema,
    docstoreVectorstoreUpdateHandler,
    docstoreVectorstoreUpdateSchema,
    type TDocstoreChunkDeleteData,
    type TDocstoreChunkDeleteInput,
    type TDocstoreChunksListData,
    type TDocstoreChunksListInput,
    type TDocstoreChunkUpdateData,
    type TDocstoreChunkUpdateInput,
    type TDocstoreComponentsData,
    type TDocstoreComponentsInput,
    type TDocstoreCreateData,
    type TDocstoreCreateInput,
    type TDocstoreDeleteData,
    type TDocstoreDeleteInput,
    type TDocstoreGetData,
    type TDocstoreGetInput,
    type TDocstoreListData,
    type TDocstoreListInput,
    type TDocstoreLoaderDeleteData,
    type TDocstoreLoaderDeleteInput,
    type TDocstoreLoaderPreviewData,
    type TDocstoreLoaderPreviewInput,
    type TDocstoreLoaderProcessData,
    type TDocstoreLoaderProcessInput,
    type TDocstoreLoaderSaveData,
    type TDocstoreLoaderSaveInput,
    type TDocstoreQueryData,
    type TDocstoreQueryInput,
    type TDocstoreRefreshData,
    type TDocstoreRefreshInput,
    type TDocstoreUpdateData,
    type TDocstoreUpdateInput,
    type TDocstoreUpsertData,
    type TDocstoreUpsertInput,
    type TDocstoreVectorstoreDeleteData,
    type TDocstoreVectorstoreDeleteInput,
    type TDocstoreVectorstoreInsertData,
    type TDocstoreVectorstoreInsertInput,
    type TDocstoreVectorstoreSaveData,
    type TDocstoreVectorstoreSaveInput,
    type TDocstoreVectorstoreUpdateData,
    type TDocstoreVectorstoreUpdateInput,
} from './docstore';
import {
    nodesGetHandler,
    nodesGetSchema,
    nodesListHandler,
    nodesListSchema,
    type TNodesGetData,
    type TNodesGetInput,
    type TNodesListData,
    type TNodesListInput,
} from './nodes';
import { pingHandler, pingSchema, type TPingData, type TPingInput } from './ping';
import {
    predictionRunHandler,
    predictionRunSchema,
    type TPredictionRunData,
    type TPredictionRunInput,
} from './prediction';
import type { TToolDefinition } from './t-tool';
import {
    upsertHistoryListHandler,
    upsertHistoryListSchema,
    type TUpsertHistoryListData,
    type TUpsertHistoryListInput,
} from './upsert-history';
import {
    variablesCreateHandler,
    variablesCreateSchema,
    variablesDeleteHandler,
    variablesDeleteSchema,
    variablesListHandler,
    variablesListSchema,
    variablesUpdateHandler,
    variablesUpdateSchema,
    type TVariablesCreateData,
    type TVariablesCreateInput,
    type TVariablesDeleteData,
    type TVariablesDeleteInput,
    type TVariablesListData,
    type TVariablesListInput,
    type TVariablesUpdateData,
    type TVariablesUpdateInput,
} from './variables';

export const tools = {
    // Misc
    flowise_ping: {
        description: 'Health-check Flowise (GET /api/v1/ping). Проверяет связь и валидность API key.',
        schema: pingSchema,
        handler: pingHandler,
    } satisfies TToolDefinition<TPingInput, TPingData>,

    // Credentials
    flowise_credentials_list: {
        description:
            'Список Flowise credentials с id и типом. Discovery credentialId перед docstore_create / chatflow_create. Опциональный фильтр по credentialName.',
        schema: credentialsListSchema,
        handler: credentialsListHandler,
    } satisfies TToolDefinition<TCredentialsListInput, TCredentialsListData>,
    flowise_credentials_get: {
        description: 'Детали credential по id (с зашифрованными данными — но не plain).',
        schema: credentialsGetSchema,
        handler: credentialsGetHandler,
    } satisfies TToolDefinition<TCredentialsGetInput, TCredentialsGetData>,
    flowise_credentials_create: {
        description:
            'Создать credential. plainDataObj — секреты в plain-text (Flowise зашифрует). credentialName определяет тип (awsApi/openAIApi/anthropicApi/PostgresApi/...).',
        schema: credentialsCreateSchema,
        handler: credentialsCreateHandler,
    } satisfies TToolDefinition<TCredentialsCreateInput, TCredentialsCreateData>,
    flowise_credentials_update: {
        description: 'Обновить credential — name или plainDataObj.',
        schema: credentialsUpdateSchema,
        handler: credentialsUpdateHandler,
    } satisfies TToolDefinition<TCredentialsUpdateInput, TCredentialsUpdateData>,
    flowise_credentials_delete: {
        description: 'Удалить credential по id (необратимо).',
        schema: credentialsDeleteSchema,
        handler: credentialsDeleteHandler,
    } satisfies TToolDefinition<TCredentialsDeleteInput, TCredentialsDeleteData>,

    // Document Store — CRUD
    flowise_docstore_list: {
        description:
            'Список Document Stores в Flowise. Возвращает id, name, status, totalChunks, hasEmbedding, hasVectorStore — компактная сводка без деталей loader-ов.',
        schema: docstoreListSchema,
        handler: docstoreListHandler,
    } satisfies TToolDefinition<TDocstoreListInput, TDocstoreListData>,
    flowise_docstore_get: {
        description: 'Детали Document Store с loader-ами и embedding/vectorstore конфигами.',
        schema: docstoreGetSchema,
        handler: docstoreGetHandler,
    } satisfies TToolDefinition<TDocstoreGetInput, TDocstoreGetData>,
    flowise_docstore_create: {
        description: 'Создать новый Document Store (только name+description; loader/embedding добавляются отдельно).',
        schema: docstoreCreateSchema,
        handler: docstoreCreateHandler,
    } satisfies TToolDefinition<TDocstoreCreateInput, TDocstoreCreateData>,
    flowise_docstore_update: {
        description: 'Обновить name/description Document Store.',
        schema: docstoreUpdateSchema,
        handler: docstoreUpdateHandler,
    } satisfies TToolDefinition<TDocstoreUpdateInput, TDocstoreUpdateData>,
    flowise_docstore_delete: {
        description: 'Удалить Document Store со всеми loader-ами и chunks (необратимо).',
        schema: docstoreDeleteSchema,
        handler: docstoreDeleteHandler,
    } satisfies TToolDefinition<TDocstoreDeleteInput, TDocstoreDeleteData>,

    // Document Store — Operations
    flowise_docstore_upsert: {
        description:
            'Запустить полный upsert цикл (loader process + embed + vector insert) одним вызовом. Использует ранее сохранённый loader (через docId) или конфиг из overrideConfig.',
        schema: docstoreUpsertSchema,
        handler: docstoreUpsertHandler,
    } satisfies TToolDefinition<TDocstoreUpsertInput, TDocstoreUpsertData>,
    flowise_docstore_refresh: {
        description: 'Re-process всех loader-ов Document Store + re-embed (для cron 4ч обновления каталога).',
        schema: docstoreRefreshSchema,
        handler: docstoreRefreshHandler,
    } satisfies TToolDefinition<TDocstoreRefreshInput, TDocstoreRefreshData>,

    // Document Store — Loaders
    flowise_docstore_loader_save: {
        description:
            'Создать или обновить loader в Document Store (S3, PDF, JSON, etc). Возвращает loader id для последующего process.',
        schema: docstoreLoaderSaveSchema,
        handler: docstoreLoaderSaveHandler,
    } satisfies TToolDefinition<TDocstoreLoaderSaveInput, TDocstoreLoaderSaveData>,
    flowise_docstore_loader_process: {
        description:
            'Запустить chunking loader-а — читает источник (S3/file/URL), разбивает по splitter, сохраняет chunks в Flowise sqlite (без embedding и без vectorstore!). После — vectorstore_save + vectorstore_insert.',
        schema: docstoreLoaderProcessSchema,
        handler: docstoreLoaderProcessHandler,
    } satisfies TToolDefinition<TDocstoreLoaderProcessInput, TDocstoreLoaderProcessData>,
    flowise_docstore_loader_preview: {
        description: 'Preview chunks без сохранения — sanity check конфигурации loader/splitter перед save+process.',
        schema: docstoreLoaderPreviewSchema,
        handler: docstoreLoaderPreviewHandler,
    } satisfies TToolDefinition<TDocstoreLoaderPreviewInput, TDocstoreLoaderPreviewData>,
    flowise_docstore_loader_delete: {
        description: 'Удалить loader из Document Store со всеми его chunks.',
        schema: docstoreLoaderDeleteSchema,
        handler: docstoreLoaderDeleteHandler,
    } satisfies TToolDefinition<TDocstoreLoaderDeleteInput, TDocstoreLoaderDeleteData>,

    // Document Store — Chunks
    flowise_docstore_chunks_list: {
        description: 'Постраничный список chunks конкретного loader (file).',
        schema: docstoreChunksListSchema,
        handler: docstoreChunksListHandler,
    } satisfies TToolDefinition<TDocstoreChunksListInput, TDocstoreChunksListData>,
    flowise_docstore_chunk_update: {
        description: 'Обновить pageContent / metadata конкретного chunk (например, поправить опечатку без полного re-process).',
        schema: docstoreChunkUpdateSchema,
        handler: docstoreChunkUpdateHandler,
    } satisfies TToolDefinition<TDocstoreChunkUpdateInput, TDocstoreChunkUpdateData>,
    flowise_docstore_chunk_delete: {
        description: 'Удалить конкретный chunk (без удаления loader-а).',
        schema: docstoreChunkDeleteSchema,
        handler: docstoreChunkDeleteHandler,
    } satisfies TToolDefinition<TDocstoreChunkDeleteInput, TDocstoreChunkDeleteData>,

    // Document Store — Vector Store
    flowise_docstore_query: {
        description:
            'Retrieval-search в Document Store без LLM-overlay (POST /document-store/vectorstore/query). top-K релевантных чанков с metadata. ~150-500ms vs ~1500-5000ms для эквивалентного Chatflow + LLM.',
        schema: docstoreQuerySchema,
        handler: docstoreQueryHandler,
    } satisfies TToolDefinition<TDocstoreQueryInput, TDocstoreQueryData>,
    flowise_docstore_vectorstore_save: {
        description:
            'Сохранить embedding + vectorstore конфиг для Document Store (без insert). Используется когда хочешь сменить provider не запуская embed.',
        schema: docstoreVectorstoreSaveSchema,
        handler: docstoreVectorstoreSaveHandler,
    } satisfies TToolDefinition<TDocstoreVectorstoreSaveInput, TDocstoreVectorstoreSaveData>,
    flowise_docstore_vectorstore_insert: {
        description:
            'Сохранить конфиг + запустить embedding + INSERT chunks в vectorstore (Postgres/Pinecone/...). Это последний шаг 4-step ingest flow (loader_save → loader_process → vectorstore_save → vectorstore_insert).',
        schema: docstoreVectorstoreInsertSchema,
        handler: docstoreVectorstoreInsertHandler,
    } satisfies TToolDefinition<TDocstoreVectorstoreInsertInput, TDocstoreVectorstoreInsertData>,
    flowise_docstore_vectorstore_update: {
        description: 'Обновить только vectorstore конфиг (без re-insert).',
        schema: docstoreVectorstoreUpdateSchema,
        handler: docstoreVectorstoreUpdateHandler,
    } satisfies TToolDefinition<TDocstoreVectorstoreUpdateInput, TDocstoreVectorstoreUpdateData>,
    flowise_docstore_vectorstore_delete: {
        description: 'Удалить data из vectorstore (Postgres TRUNCATE / Pinecone delete-all). Document Store остаётся, embeddingConfig сохраняется.',
        schema: docstoreVectorstoreDeleteSchema,
        handler: docstoreVectorstoreDeleteHandler,
    } satisfies TToolDefinition<TDocstoreVectorstoreDeleteInput, TDocstoreVectorstoreDeleteData>,

    // Document Store — Components discovery
    flowise_docstore_components_loaders: {
        description: 'Список доступных Document Loader nodes (S3, PDF, JSON, Web, GitHub, ...) с их inputs schema.',
        schema: docstoreComponentsSchema,
        handler: docstoreComponentsLoadersHandler,
    } satisfies TToolDefinition<TDocstoreComponentsInput, TDocstoreComponentsData>,
    flowise_docstore_components_embeddings: {
        description: 'Список embedding providers (OpenAI / Cohere / VoyageAI / Azure / ...) с inputs.',
        schema: docstoreComponentsSchema,
        handler: docstoreComponentsEmbeddingsHandler,
    } satisfies TToolDefinition<TDocstoreComponentsInput, TDocstoreComponentsData>,
    flowise_docstore_components_vectorstore: {
        description: 'Список vectorstore providers (Postgres/pgvector, Pinecone, Qdrant, Weaviate, ...) с inputs.',
        schema: docstoreComponentsSchema,
        handler: docstoreComponentsVectorstoreHandler,
    } satisfies TToolDefinition<TDocstoreComponentsInput, TDocstoreComponentsData>,
    flowise_docstore_components_recordmanager: {
        description: 'Список Record Manager providers (для idempotent upserts через doc-id tracking).',
        schema: docstoreComponentsSchema,
        handler: docstoreComponentsRecordManagerHandler,
    } satisfies TToolDefinition<TDocstoreComponentsInput, TDocstoreComponentsData>,

    // Chatflow
    flowise_chatflow_list: {
        description:
            'Список Chatflows с фильтром по type (CHATFLOW/AGENTFLOW/MULTIAGENT/ASSISTANT). Без flowData — сводка id/name/deployed/isPublic.',
        schema: chatflowListSchema,
        handler: chatflowListHandler,
    } satisfies TToolDefinition<TChatflowListInput, TChatflowListData>,
    flowise_chatflow_get: {
        description:
            'Детали Chatflow. По умолчанию без flowData (большой JSON со всем флоу) — передай includeFlowData=true для full export.',
        schema: chatflowGetSchema,
        handler: chatflowGetHandler,
    } satisfies TToolDefinition<TChatflowGetInput, TChatflowGetData>,
    flowise_chatflow_get_by_apikey: {
        description: 'Список Chatflows доступных по конкретному API key (фильтр по apikeyid).',
        schema: chatflowGetByApiKeySchema,
        handler: chatflowGetByApiKeyHandler,
    } satisfies TToolDefinition<TChatflowGetByApiKeyInput, TChatflowGetByApiKeyData>,
    flowise_chatflow_create: {
        description:
            'Создать новый Chatflow с готовым flowData (JSON nodes+edges). Для генерации flowData — сначала nodes_list/get для discovery node specs.',
        schema: chatflowCreateSchema,
        handler: chatflowCreateHandler,
    } satisfies TToolDefinition<TChatflowCreateInput, TChatflowCreateData>,
    flowise_chatflow_update: {
        description: 'Обновить Chatflow (name, flowData, deployed, isPublic, configs).',
        schema: chatflowUpdateSchema,
        handler: chatflowUpdateHandler,
    } satisfies TToolDefinition<TChatflowUpdateInput, TChatflowUpdateData>,
    flowise_chatflow_delete: {
        description: 'Удалить Chatflow (необратимо).',
        schema: chatflowDeleteSchema,
        handler: chatflowDeleteHandler,
    } satisfies TToolDefinition<TChatflowDeleteInput, TChatflowDeleteData>,

    // Nodes
    flowise_nodes_list: {
        description:
            'Список всех нод Flowise (или фильтр по category — Chat Models, Embeddings, Document Loaders, Tools, Vector Stores, ...). Discovery для chatflow_create.',
        schema: nodesListSchema,
        handler: nodesListHandler,
    } satisfies TToolDefinition<TNodesListInput, TNodesListData>,
    flowise_nodes_get: {
        description:
            'Детальная schema конкретной ноды (inputs с типами, outputs, credential requirements). Использовать перед сборкой flowData в chatflow_create.',
        schema: nodesGetSchema,
        handler: nodesGetHandler,
    } satisfies TToolDefinition<TNodesGetInput, TNodesGetData>,

    // Predictions
    flowise_prediction_run: {
        description:
            'Запустить prediction на Chatflow с question/form/uploads/history. Поддерживает image uploads (base64) для vision-флоу. streaming=false для MCP контекста.',
        schema: predictionRunSchema,
        handler: predictionRunHandler,
    } satisfies TToolDefinition<TPredictionRunInput, TPredictionRunData>,

    // Variables
    flowise_variables_list: {
        description: 'Список runtime/static переменных Flowise (для подстановки в промпты через {{varname}}).',
        schema: variablesListSchema,
        handler: variablesListHandler,
    } satisfies TToolDefinition<TVariablesListInput, TVariablesListData>,
    flowise_variables_create: {
        description: 'Создать переменную (type=static — фиксированное значение, runtime — подставляется при каждом prediction).',
        schema: variablesCreateSchema,
        handler: variablesCreateHandler,
    } satisfies TToolDefinition<TVariablesCreateInput, TVariablesCreateData>,
    flowise_variables_update: {
        description: 'Обновить переменную (name/value/type).',
        schema: variablesUpdateSchema,
        handler: variablesUpdateHandler,
    } satisfies TToolDefinition<TVariablesUpdateInput, TVariablesUpdateData>,
    flowise_variables_delete: {
        description: 'Удалить переменную (необратимо).',
        schema: variablesDeleteSchema,
        handler: variablesDeleteHandler,
    } satisfies TToolDefinition<TVariablesDeleteInput, TVariablesDeleteData>,

    // Custom Tools
    flowise_custom_tools_list: {
        description: 'Список Custom Tools (JS-функции с zod-schema, используются как tools для агентов).',
        schema: customToolsListSchema,
        handler: customToolsListHandler,
    } satisfies TToolDefinition<TCustomToolsListInput, TCustomToolsListData>,
    flowise_custom_tools_get: {
        description: 'Детали Custom Tool (schema arguments + func body).',
        schema: customToolsGetSchema,
        handler: customToolsGetHandler,
    } satisfies TToolDefinition<TCustomToolsGetInput, TCustomToolsGetData>,
    flowise_custom_tools_create: {
        description: 'Создать Custom Tool. schema — JSON-schema arguments, func — JS-код тела.',
        schema: customToolsCreateSchema,
        handler: customToolsCreateHandler,
    } satisfies TToolDefinition<TCustomToolsCreateInput, TCustomToolsCreateData>,
    flowise_custom_tools_update: {
        description: 'Обновить Custom Tool (name, description, schema, func).',
        schema: customToolsUpdateSchema,
        handler: customToolsUpdateHandler,
    } satisfies TToolDefinition<TCustomToolsUpdateInput, TCustomToolsUpdateData>,
    flowise_custom_tools_delete: {
        description: 'Удалить Custom Tool (необратимо).',
        schema: customToolsDeleteSchema,
        handler: customToolsDeleteHandler,
    } satisfies TToolDefinition<TCustomToolsDeleteInput, TCustomToolsDeleteData>,

    // Assistants
    flowise_assistants_list: {
        description: 'Список ассистентов (OPENAI/AZURE/CUSTOM) с фильтром по type.',
        schema: assistantsListSchema,
        handler: assistantsListHandler,
    } satisfies TToolDefinition<TAssistantsListInput, TAssistantsListData>,
    flowise_assistants_get: {
        description: 'Детали ассистента — instructions, model, tools (JSON-сериализованы в details).',
        schema: assistantsGetSchema,
        handler: assistantsGetHandler,
    } satisfies TToolDefinition<TAssistantsGetInput, TAssistantsGetData>,
    flowise_assistants_create: {
        description: 'Создать ассистента. details — JSON-строка с instructions/model/tools/...',
        schema: assistantsCreateSchema,
        handler: assistantsCreateHandler,
    } satisfies TToolDefinition<TAssistantsCreateInput, TAssistantsCreateData>,
    flowise_assistants_update: {
        description: 'Обновить ассистента (details, credential, iconSrc).',
        schema: assistantsUpdateSchema,
        handler: assistantsUpdateHandler,
    } satisfies TToolDefinition<TAssistantsUpdateInput, TAssistantsUpdateData>,
    flowise_assistants_delete: {
        description: 'Удалить ассистента (необратимо).',
        schema: assistantsDeleteSchema,
        handler: assistantsDeleteHandler,
    } satisfies TToolDefinition<TAssistantsDeleteInput, TAssistantsDeleteData>,

    // Chat messages / History
    flowise_chatmessage_list: {
        description: 'История чатов конкретного Chatflow с фильтрами (chatId/chatType/limit). Для дебага диалогов.',
        schema: chatmessageListSchema,
        handler: chatmessageListHandler,
    } satisfies TToolDefinition<TChatmessageListInput, TChatmessageListData>,
    flowise_upsert_history_list: {
        description: 'История upsert операций для Chatflow (когда и как embed обновлялся).',
        schema: upsertHistoryListSchema,
        handler: upsertHistoryListHandler,
    } satisfies TToolDefinition<TUpsertHistoryListInput, TUpsertHistoryListData>,
} as const;
