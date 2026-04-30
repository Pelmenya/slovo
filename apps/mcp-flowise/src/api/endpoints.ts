export const ENDPOINTS = {
    ping: '/api/v1/ping',

    // Credentials
    credentials: '/api/v1/credentials',
    credentialById: (id: string): string => `/api/v1/credentials/${id}`,

    // Document Store — Stores
    documentStores: '/api/v1/document-store/store',
    documentStoreById: (id: string): string => `/api/v1/document-store/store/${id}`,

    // Document Store — Operations
    documentStoreUpsert: (id: string): string => `/api/v1/document-store/upsert/${id}`,
    documentStoreRefresh: (id: string): string => `/api/v1/document-store/refresh/${id}`,

    // Document Store — Loaders
    docstoreLoaderSave: '/api/v1/document-store/loader/save',
    docstoreLoaderProcess: (loaderId: string): string => `/api/v1/document-store/loader/process/${loaderId}`,
    docstoreLoaderPreview: '/api/v1/document-store/loader/preview',
    docstoreLoaderDelete: (storeId: string, loaderId: string): string =>
        `/api/v1/document-store/loader/${storeId}/${loaderId}`,

    // Document Store — Chunks
    docstoreChunksList: (storeId: string, fileId: string, pageNo: number): string =>
        `/api/v1/document-store/chunks/${storeId}/${fileId}/${pageNo}`,
    docstoreChunkUpdate: (storeId: string, loaderId: string, chunkId: string): string =>
        `/api/v1/document-store/chunks/${storeId}/${loaderId}/${chunkId}`,
    docstoreChunkDelete: (storeId: string, loaderId: string, chunkId: string): string =>
        `/api/v1/document-store/chunks/${storeId}/${loaderId}/${chunkId}`,

    // Document Store — Vector Store
    vectorstoreQuery: '/api/v1/document-store/vectorstore/query',
    vectorstoreSave: '/api/v1/document-store/vectorstore/save',
    vectorstoreInsert: '/api/v1/document-store/vectorstore/insert',
    vectorstoreUpdate: '/api/v1/document-store/vectorstore/update',
    vectorstoreDelete: (storeId: string): string => `/api/v1/document-store/vectorstore/${storeId}`,

    // Document Store — Components discovery
    docstoreComponentsLoaders: '/api/v1/document-store/components/loaders',
    docstoreComponentsEmbeddings: '/api/v1/document-store/components/embeddings',
    docstoreComponentsVectorstore: '/api/v1/document-store/components/vectorstore',
    docstoreComponentsRecordManager: '/api/v1/document-store/components/recordmanager',

    // Chatflows
    chatflows: '/api/v1/chatflows',
    chatflowById: (id: string): string => `/api/v1/chatflows/${id}`,
    chatflowByApiKey: (apikey: string): string => `/api/v1/chatflows/apikey/${apikey}`,

    // Nodes
    nodes: '/api/v1/nodes',
    nodeByName: (name: string): string => `/api/v1/nodes/${name}`,
    nodesByCategory: (category: string): string => `/api/v1/nodes/category/${category}`,

    // Predictions
    prediction: (chatflowId: string): string => `/api/v1/prediction/${chatflowId}`,

    // Variables
    variables: '/api/v1/variables',
    variableById: (id: string): string => `/api/v1/variables/${id}`,

    // Custom Tools
    customTools: '/api/v1/tools',
    customToolById: (id: string): string => `/api/v1/tools/${id}`,

    // Assistants
    assistants: '/api/v1/assistants',
    assistantById: (id: string): string => `/api/v1/assistants/${id}`,

    // Chat messages
    chatMessages: (chatflowId: string): string => `/api/v1/chatmessage/${chatflowId}`,

    // Upsert history
    upsertHistory: (chatflowId: string): string => `/api/v1/upsert-history/${chatflowId}`,
} as const;
