import { nodeFromSpec } from '../nodes-base';
import type { TFlowNode } from '../t-flowdata';

// =============================================================================
// jsonFile — Json File Loader (один из самых используемых)
// =============================================================================

export type TJsonFileInputs = {
    jsonFile?: string;
    separateByObject?: boolean;
    pointersName?: string;
    metadata?: string;
    omitMetadataKeys?: string;
};

export type TJsonFileParams = {
    id: string;
    inputs?: TJsonFileInputs;
    position?: { x: number; y: number };
};

export function jsonFile(params: TJsonFileParams): TFlowNode {
    return nodeFromSpec({
        id: params.id,
        position: params.position,
        inputs: params.inputs,
        spec: {
            label: 'Json File',
            name: 'jsonFile',
            type: 'Document',
            version: 3,
            category: 'Document Loaders',
            description: 'Load data from JSON files',
            baseClasses: ['Document'],
            inputs: [
                { label: 'Json File', name: 'jsonFile', type: 'file' },
                { label: 'Text Splitter', name: 'textSplitter', type: 'TextSplitter', optional: true },
                { label: 'Separate by Object', name: 'separateByObject', type: 'boolean', optional: true },
                { label: 'Pointers Extraction (separated by commas)', name: 'pointersName', type: 'string', optional: true },
                { label: 'Additional Metadata', name: 'metadata', type: 'json', optional: true },
                { label: 'Omit Metadata Keys', name: 'omitMetadataKeys', type: 'string', optional: true },
            ],
            outputs: [
                { label: 'Output', name: 'output', type: 'options' },
            ],
        },
    });
}

// =============================================================================
// s3 — S3 File Loader (для production ingest из MinIO/S3)
// =============================================================================

export type TS3InputsBase = {
    bucketName: string;
    keyName: string;
    region?: string;
    fileProcessingMethod?: 'builtIn' | 'unstructured';
    metadata?: string;
    omitMetadataKeys?: string;
};

export type TS3Params = {
    id: string;
    inputs: TS3InputsBase;
    credential?: string;
    position?: { x: number; y: number };
};

export function s3File(params: TS3Params): TFlowNode {
    return nodeFromSpec({
        id: params.id,
        position: params.position,
        credential: params.credential,
        inputs: { region: 'us-east-1', fileProcessingMethod: 'builtIn', ...params.inputs },
        spec: {
            label: 'S3',
            name: 'S3',
            type: 'Document',
            version: 5,
            category: 'Document Loaders',
            description: 'Load Data from S3 Buckets',
            baseClasses: ['Document'],
            inputs: [
                { label: 'Bucket', name: 'bucketName', type: 'string' },
                { label: 'Object Key', name: 'keyName', type: 'string' },
                { label: 'Region', name: 'region', type: 'asyncOptions' },
                { label: 'File Processing Method', name: 'fileProcessingMethod', type: 'options' },
                { label: 'Text Splitter', name: 'textSplitter', type: 'TextSplitter', optional: true },
                { label: 'Additional Metadata', name: 'metadata', type: 'json', optional: true },
                { label: 'Omit Metadata Keys', name: 'omitMetadataKeys', type: 'string', optional: true },
            ],
            outputs: [
                { label: 'Output', name: 'output', type: 'options' },
            ],
        },
    });
}
