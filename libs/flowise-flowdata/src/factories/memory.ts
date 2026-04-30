import { nodeFromSpec } from '../nodes-base';
import type { TFlowNode } from '../t-flowdata';

export type TBufferMemoryInputs = {
    sessionId?: string;
    memoryKey?: string;
};

export type TBufferMemoryParams = {
    id: string;
    inputs?: TBufferMemoryInputs;
    position?: { x: number; y: number };
};

export function bufferMemory(params: TBufferMemoryParams): TFlowNode {
    return nodeFromSpec({
        id: params.id,
        position: params.position,
        inputs: params.inputs,
        spec: {
            label: 'Buffer Memory',
            name: 'bufferMemory',
            type: 'BufferMemory',
            version: 2,
            category: 'Memory',
            description: 'Retrieve chat messages stored in database',
            baseClasses: ['BufferMemory', 'BaseChatMemory', 'BaseMemory'],
            inputs: [
                { label: 'Session Id', name: 'sessionId', type: 'string', optional: true },
                { label: 'Memory Key', name: 'memoryKey', type: 'string', optional: true },
            ],
        },
    });
}

export type TBufferWindowMemoryInputs = {
    k?: number;
    sessionId?: string;
    memoryKey?: string;
};

export type TBufferWindowMemoryParams = {
    id: string;
    inputs?: TBufferWindowMemoryInputs;
    position?: { x: number; y: number };
};

export function bufferWindowMemory(params: TBufferWindowMemoryParams): TFlowNode {
    return nodeFromSpec({
        id: params.id,
        position: params.position,
        inputs: params.inputs,
        spec: {
            label: 'Buffer Window Memory',
            name: 'bufferWindowMemory',
            type: 'BufferWindowMemory',
            version: 2,
            category: 'Memory',
            description: 'Last K conversations are kept in memory',
            baseClasses: ['BufferWindowMemory', 'BaseChatMemory', 'BaseMemory'],
            inputs: [
                { label: 'Window Size (K)', name: 'k', type: 'number', optional: true },
                { label: 'Session Id', name: 'sessionId', type: 'string', optional: true },
                { label: 'Memory Key', name: 'memoryKey', type: 'string', optional: true },
            ],
        },
    });
}
