"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ENDPOINTS = void 0;
exports.ENDPOINTS = {
    ping: '/api/v1/ping',
    // Credentials
    credentials: '/api/v1/credentials',
    credentialById: (id) => `/api/v1/credentials/${id}`,
    // Document Store — Stores
    documentStores: '/api/v1/document-store/store',
    documentStoreById: (id) => `/api/v1/document-store/store/${id}`,
    // Document Store — Operations
    documentStoreUpsert: (id) => `/api/v1/document-store/upsert/${id}`,
    documentStoreRefresh: (id) => `/api/v1/document-store/refresh/${id}`,
    // Document Store — Loaders
    docstoreLoaderSave: '/api/v1/document-store/loader/save',
    docstoreLoaderProcess: (loaderId) => `/api/v1/document-store/loader/process/${loaderId}`,
    docstoreLoaderPreview: '/api/v1/document-store/loader/preview',
    docstoreLoaderDelete: (storeId, loaderId) => `/api/v1/document-store/loader/${storeId}/${loaderId}`,
    // Document Store — Chunks
    docstoreChunksList: (storeId, fileId, pageNo) => `/api/v1/document-store/chunks/${storeId}/${fileId}/${pageNo}`,
    docstoreChunkUpdate: (storeId, loaderId, chunkId) => `/api/v1/document-store/chunks/${storeId}/${loaderId}/${chunkId}`,
    docstoreChunkDelete: (storeId, loaderId, chunkId) => `/api/v1/document-store/chunks/${storeId}/${loaderId}/${chunkId}`,
    // Document Store — Vector Store
    vectorstoreQuery: '/api/v1/document-store/vectorstore/query',
    vectorstoreSave: '/api/v1/document-store/vectorstore/save',
    vectorstoreInsert: '/api/v1/document-store/vectorstore/insert',
    vectorstoreUpdate: '/api/v1/document-store/vectorstore/update',
    vectorstoreDelete: (storeId) => `/api/v1/document-store/vectorstore/${storeId}`,
    // Document Store — Components discovery
    docstoreComponentsLoaders: '/api/v1/document-store/components/loaders',
    docstoreComponentsEmbeddings: '/api/v1/document-store/components/embeddings',
    docstoreComponentsVectorstore: '/api/v1/document-store/components/vectorstore',
    docstoreComponentsRecordManager: '/api/v1/document-store/components/recordmanager',
    // Chatflows
    chatflows: '/api/v1/chatflows',
    chatflowById: (id) => `/api/v1/chatflows/${id}`,
    chatflowByApiKey: (apikey) => `/api/v1/chatflows/apikey/${apikey}`,
    // Nodes
    nodes: '/api/v1/nodes',
    nodeByName: (name) => `/api/v1/nodes/${name}`,
    nodesByCategory: (category) => `/api/v1/nodes/category/${category}`,
    // Predictions
    prediction: (chatflowId) => `/api/v1/prediction/${chatflowId}`,
    // Vector store upsert (для legacy chatflows со встроенным vector store)
    vectorUpsert: (chatflowId) => `/api/v1/vector/upsert/${chatflowId}`,
    // Attachments (file upload отдельно от prediction)
    attachments: (chatflowId) => `/api/v1/attachments/${chatflowId}`,
    // Document store — generate tool description через LLM
    docstoreGenerateToolDesc: (id) => `/api/v1/document-store/generate-tool-desc/${id}`,
    // Variables
    variables: '/api/v1/variables',
    variableById: (id) => `/api/v1/variables/${id}`,
    // Custom Tools
    customTools: '/api/v1/tools',
    customToolById: (id) => `/api/v1/tools/${id}`,
    // Assistants
    assistants: '/api/v1/assistants',
    assistantById: (id) => `/api/v1/assistants/${id}`,
    // Chat messages
    chatMessages: (chatflowId) => `/api/v1/chatmessage/${chatflowId}`,
    chatMessagesAbort: (chatflowId, chatId) => `/api/v1/chatmessage/abort/${chatflowId}/${chatId}`,
    // Upsert history
    upsertHistory: (chatflowId) => `/api/v1/upsert-history/${chatflowId}`,
    upsertHistoryRoot: '/api/v1/upsert-history',
};
//# sourceMappingURL=endpoints.js.map