export type TFlowiseCredential = {
    id: string;
    name: string;
    credentialName: string;
    workspaceId?: string;
    createdDate?: string;
    updatedDate?: string;
};

export type TFlowiseDocumentStoreLoader = {
    id: string;
    loaderId: string;
    loaderName: string;
    splitterId?: string;
    splitterName?: string;
    totalChunks: number;
    totalChars: number;
    status: string;
    source?: string;
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
