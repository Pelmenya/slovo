import { nodeFromSpec } from '../nodes-base';
import type { TFlowNode } from '../t-flowdata';

// =============================================================================
// postgres (pgvector) — основной vectorstore в slovo
// =============================================================================

export type TPostgresInputs = {
    host?: string;
    database?: string;
    port?: number;
    ssl?: boolean;
    tableName?: string;
    distanceStrategy?: 'cosine' | 'euclidean' | 'innerProduct';
    fileUpload?: boolean;
    batchSize?: number;
    additionalConfig?: string;
    topK?: number;
    contentColumnName?: string;
};

export type TPostgresParams = {
    id: string;
    inputs?: TPostgresInputs;
    credential?: string;
    position?: { x: number; y: number };
};

export function postgresVectorStore(params: TPostgresParams): TFlowNode {
    return nodeFromSpec({
        id: params.id,
        position: params.position,
        credential: params.credential,
        inputs: params.inputs,
        spec: {
            label: 'Postgres',
            name: 'postgres',
            type: 'Postgres',
            version: 9,
            category: 'Vector Stores',
            description: 'Upsert embedded data and perform similarity search upon query using pgvector on Postgres',
            baseClasses: ['Postgres', 'VectorStoreRetriever', 'BaseRetriever'],
            inputs: [
                { label: 'Document', name: 'document', type: 'Document', optional: true, list: true },
                { label: 'Embeddings', name: 'embeddings', type: 'Embeddings' },
                { label: 'Record Manager', name: 'recordManager', type: 'RecordManager', optional: true },
                { label: 'Host', name: 'host', type: 'string' },
                { label: 'Database', name: 'database', type: 'string' },
                { label: 'Port', name: 'port', type: 'number', optional: true },
                { label: 'SSL', name: 'ssl', type: 'boolean', optional: true },
                { label: 'Table Name', name: 'tableName', type: 'string', optional: true },
                { label: 'Distance Strategy', name: 'distanceStrategy', type: 'options', optional: true },
                { label: 'File Upload', name: 'fileUpload', type: 'boolean', optional: true },
                { label: 'Batch Size', name: 'batchSize', type: 'number', optional: true },
                { label: 'Additional Config', name: 'additionalConfig', type: 'json', optional: true },
                { label: 'Top K', name: 'topK', type: 'number', optional: true },
                { label: 'Content Column Name', name: 'contentColumnName', type: 'string', optional: true },
            ],
            outputs: [
                { label: 'Output', name: 'output', type: 'options' },
            ],
        },
    });
}

// =============================================================================
// documentStoreVS — Document Store as VectorStore (использовать существующий
// store вместо настройки нового)
// =============================================================================

export type TDocumentStoreVSInputs = {
    selectedStore?: string;
};

export type TDocumentStoreVSParams = {
    id: string;
    inputs?: TDocumentStoreVSInputs;
    position?: { x: number; y: number };
};

export function documentStoreVS(params: TDocumentStoreVSParams): TFlowNode {
    return nodeFromSpec({
        id: params.id,
        position: params.position,
        inputs: params.inputs,
        spec: {
            label: 'Document Store (Vector)',
            name: 'documentStoreVS',
            type: 'DocumentStoreVS',
            version: 1,
            category: 'Vector Stores',
            description: 'Use existing Document Store as Vector Store',
            baseClasses: ['DocumentStoreVS', 'BaseRetriever'],
            inputs: [
                { label: 'Selected Store', name: 'selectedStore', type: 'asyncOptions' },
            ],
            outputs: [
                { label: 'Output', name: 'output', type: 'options' },
            ],
        },
    });
}
