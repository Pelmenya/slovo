import { nodeFromSpec } from '../nodes-base';
import type { TFlowNode } from '../t-flowdata';

export type TOpenAIEmbeddingsInputs = {
    modelName?: string;
    stripNewLines?: boolean;
    batchSize?: number;
    timeout?: number;
    basepath?: string;
    dimensions?: number;
    encodingFormat?: 'float' | 'base64';
};

export type TOpenAIEmbeddingsParams = {
    id: string;
    inputs?: TOpenAIEmbeddingsInputs;
    credential?: string;
    position?: { x: number; y: number };
};

export function openAIEmbeddings(params: TOpenAIEmbeddingsParams): TFlowNode {
    return nodeFromSpec({
        id: params.id,
        position: params.position,
        credential: params.credential,
        inputs: params.inputs,
        spec: {
            label: 'OpenAI Embeddings',
            name: 'openAIEmbeddings',
            type: 'OpenAIEmbeddings',
            version: 4,
            category: 'Embeddings',
            description: 'OpenAI API to generate embeddings',
            baseClasses: ['OpenAIEmbeddings', 'Embeddings'],
            inputs: [
                { label: 'Model Name', name: 'modelName', type: 'asyncOptions' },
                { label: 'Strip New Lines', name: 'stripNewLines', type: 'boolean', optional: true },
                { label: 'Batch Size', name: 'batchSize', type: 'number', optional: true },
                { label: 'Timeout', name: 'timeout', type: 'number', optional: true },
                { label: 'BasePath', name: 'basepath', type: 'string', optional: true },
                { label: 'Dimensions', name: 'dimensions', type: 'number', optional: true },
                { label: 'Encoding Format', name: 'encodingFormat', type: 'options', optional: true },
            ],
        },
    });
}
