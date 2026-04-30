import { nodeFromSpec } from '../nodes-base';
import type { TFlowNode } from '../t-flowdata';

export type TRecursiveCharacterTextSplitterInputs = {
    chunkSize?: number;
    chunkOverlap?: number;
    separators?: string;
};

export type TRecursiveCharacterTextSplitterParams = {
    id: string;
    inputs?: TRecursiveCharacterTextSplitterInputs;
    position?: { x: number; y: number };
};

export function recursiveCharacterTextSplitter(
    params: TRecursiveCharacterTextSplitterParams,
): TFlowNode {
    return nodeFromSpec({
        id: params.id,
        position: params.position,
        inputs: params.inputs,
        spec: {
            label: 'Recursive Character Text Splitter',
            name: 'recursiveCharacterTextSplitter',
            type: 'RecursiveCharacterTextSplitter',
            version: 2,
            category: 'Text Splitters',
            description: 'Split documents recursively by different characters - starting with "\\n\\n", then "\\n", then " "',
            baseClasses: [
                'RecursiveCharacterTextSplitter',
                'TextSplitter',
                'BaseDocumentTransformer',
                'Runnable',
            ],
            inputs: [
                { label: 'Chunk Size', name: 'chunkSize', type: 'number', optional: true },
                { label: 'Chunk Overlap', name: 'chunkOverlap', type: 'number', optional: true },
                { label: 'Custom Separators', name: 'separators', type: 'string', optional: true },
            ],
        },
    });
}
