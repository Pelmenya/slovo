// =============================================================================
// Credentials
// =============================================================================

export type TFlowiseCredential = {
    id: string;
    name: string;
    credentialName: string;
    workspaceId?: string;
    createdDate?: string;
    updatedDate?: string;
};

export type TFlowiseCredentialDetail = TFlowiseCredential & {
    plainDataObj?: Record<string, unknown>;
    encryptedData?: string;
};

// =============================================================================
// Document Store
// =============================================================================

export type TFlowiseDocumentStoreLoader = {
    id: string;
    loaderId: string;
    loaderName: string;
    loaderConfig?: Record<string, unknown>;
    splitterId?: string;
    splitterName?: string;
    splitterConfig?: Record<string, unknown>;
    totalChunks: number;
    totalChars: number;
    status: string;
    source?: string;
    credential?: string;
    files?: Array<{ id: string; name: string; mimePrefix: string; size: number }>;
};

export type TFlowiseDocumentStore = {
    id: string;
    name: string;
    description?: string | null;
    status: string;
    loaders: TFlowiseDocumentStoreLoader[];
    whereUsed: string[];
    vectorStoreConfig: string | null;
    embeddingConfig: string | null;
    recordManagerConfig: string | null;
    workspaceId?: string;
    totalChunks: number;
    totalChars: number;
    createdDate?: string;
    updatedDate?: string;
};

export type TFlowiseDocumentStoreChunk = {
    id: string;
    docId: string;
    pageContent: string;
    metadata: string | Record<string, unknown>;
    storeId: string;
    chunkNo?: number;
};

export type TFlowiseDocumentStoreChunksResponse = {
    chunks: TFlowiseDocumentStoreChunk[];
    count: number;
    file?: TFlowiseDocumentStoreLoader;
    currentPage?: number;
    storeName?: string;
    description?: string;
    workspaceId?: string;
    docId?: string;
    characters?: number;
};

export type TFlowiseQueryDoc = {
    pageContent: string;
    metadata: Record<string, unknown>;
    id: string;
    chunkNo?: number;
};

export type TFlowiseQueryResponse = {
    timeTaken: number;
    docs: TFlowiseQueryDoc[];
};

export type TFlowiseLoaderPreviewResponse = {
    chunks: Array<{
        pageContent: string;
        metadata: Record<string, unknown>;
    }>;
    totalChunks: number;
    previewChunkCount?: number;
};

export type TFlowiseComponentNode = {
    label: string;
    name: string;
    version: number;
    type: string;
    icon?: string;
    category: string;
    description?: string;
    baseClasses: string[];
    inputs?: Array<{
        label: string;
        name: string;
        type: string;
        description?: string;
        optional?: boolean;
        default?: unknown;
        options?: Array<{ label: string; name: string; description?: string }>;
    }>;
    outputs?: Array<{ label: string; name: string; baseClasses?: string[] }>;
    credential?: { label: string; name: string; type: string; credentialNames?: string[] };
};

// =============================================================================
// Chatflow
// =============================================================================

export type TFlowiseChatflow = {
    id: string;
    name: string;
    flowData: string;
    deployed?: boolean;
    isPublic?: boolean;
    apikeyid?: string;
    chatbotConfig?: string | null;
    apiConfig?: string | null;
    analytic?: string | null;
    speechToText?: string | null;
    followUpPrompts?: string | null;
    category?: string | null;
    type?: 'CHATFLOW' | 'AGENTFLOW' | 'MULTIAGENT' | 'ASSISTANT';
    workspaceId?: string;
    createdDate?: string;
    updatedDate?: string;
};

// =============================================================================
// Predictions
// =============================================================================

export type TFlowisePredictionUpload = {
    data: string;
    type: 'file' | 'url' | 'audio';
    name: string;
    mime: string;
};

export type TFlowisePredictionRequest = {
    question?: string;
    form?: Record<string, unknown>;
    overrideConfig?: Record<string, unknown>;
    history?: Array<{ role: 'apiMessage' | 'userMessage'; content: string }>;
    uploads?: TFlowisePredictionUpload[];
    chatId?: string;
    streaming?: boolean;
    humanInput?: { type: string; feedback: string; startNodeId?: string };
    leadEmail?: string;
};

export type TFlowisePredictionResponse = {
    text?: string;
    json?: Record<string, unknown>;
    question?: string;
    chatId?: string;
    chatMessageId?: string;
    sessionId?: string;
    memoryType?: string;
    sourceDocuments?: TFlowiseQueryDoc[];
    isStreamValid?: boolean;
    usedTools?: unknown[];
    fileAnnotations?: unknown[];
};

// =============================================================================
// Variables / Custom Tools / Assistants
// =============================================================================

export type TFlowiseVariable = {
    id: string;
    name: string;
    value: string;
    type: 'static' | 'runtime';
    workspaceId?: string;
    createdDate?: string;
    updatedDate?: string;
};

export type TFlowiseCustomTool = {
    id: string;
    name: string;
    description: string;
    color?: string;
    iconSrc?: string | null;
    schema?: string;
    func?: string;
    workspaceId?: string;
    createdDate?: string;
    updatedDate?: string;
};

export type TFlowiseAssistant = {
    id: string;
    credential?: string;
    details: string;
    iconSrc?: string | null;
    type?: 'OPENAI' | 'AZURE' | 'CUSTOM';
    workspaceId?: string;
    createdDate?: string;
    updatedDate?: string;
};

// =============================================================================
// Chat messages / Upsert history
// =============================================================================

export type TFlowiseChatMessage = {
    id: string;
    role: 'apiMessage' | 'userMessage';
    chatflowid: string;
    chatId: string;
    content: string;
    sourceDocuments?: string;
    usedTools?: string;
    fileAnnotations?: string;
    fileUploads?: string;
    chatType?: 'EXTERNAL' | 'INTERNAL';
    sessionId?: string;
    memoryType?: string;
    createdDate?: string;
};

export type TFlowiseUpsertHistory = {
    id: string;
    chatflowid: string;
    result: string;
    flowData: string;
    date?: string;
};
