import { nodeFromSpec } from '../nodes-base';
import type { TFlowNode } from '../t-flowdata';

// =============================================================================
// chatAnthropic — Claude (Anthropic). Самая используемая Chat Model в slovo.
// =============================================================================

export type TChatAnthropicInputs = {
    modelName?: string;
    temperature?: number;
    streaming?: boolean;
    allowImageUploads?: boolean;
    extendedThinking?: boolean;
    budgetTokens?: number;
    maxTokensToSample?: number;
    topP?: number;
    topK?: number;
};

export type TChatAnthropicParams = {
    id: string;
    inputs?: TChatAnthropicInputs;
    credential?: string;
    position?: { x: number; y: number };
};

export function chatAnthropic(params: TChatAnthropicParams): TFlowNode {
    return nodeFromSpec({
        id: params.id,
        position: params.position,
        credential: params.credential,
        inputs: params.inputs,
        spec: {
            label: 'ChatAnthropic',
            name: 'chatAnthropic',
            type: 'ChatAnthropic',
            version: 8,
            category: 'Chat Models',
            description: 'Wrapper around ChatAnthropic large language models that use the Chat endpoint',
            baseClasses: ['ChatAnthropic', 'ChatAnthropicMessages', 'BaseChatModel', 'BaseLanguageModel', 'Runnable'],
            inputs: [
                { label: 'Cache', name: 'cache', type: 'BaseCache', optional: true },
                { label: 'Model Name', name: 'modelName', type: 'asyncOptions' },
                { label: 'Temperature', name: 'temperature', type: 'number', optional: true },
                { label: 'Streaming', name: 'streaming', type: 'boolean', optional: true },
                { label: 'Allow Image Uploads', name: 'allowImageUploads', type: 'boolean', optional: true },
                { label: 'Extended Thinking', name: 'extendedThinking', type: 'boolean', optional: true },
                { label: 'Budget Tokens', name: 'budgetTokens', type: 'number', optional: true },
                { label: 'Max Tokens', name: 'maxTokensToSample', type: 'number', optional: true },
                { label: 'Top P', name: 'topP', type: 'number', optional: true },
                { label: 'Top K', name: 'topK', type: 'number', optional: true },
            ],
        },
    });
}

// =============================================================================
// chatOpenAI — для сравнения / fallback
// =============================================================================

export type TChatOpenAIInputs = {
    modelName?: string;
    temperature?: number;
    maxTokens?: number;
    streaming?: boolean;
    topP?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    timeout?: number;
    basepath?: string;
};

export type TChatOpenAIParams = {
    id: string;
    inputs?: TChatOpenAIInputs;
    credential?: string;
    position?: { x: number; y: number };
};

export function chatOpenAI(params: TChatOpenAIParams): TFlowNode {
    return nodeFromSpec({
        id: params.id,
        position: params.position,
        credential: params.credential,
        inputs: params.inputs,
        spec: {
            label: 'OpenAI',
            name: 'chatOpenAI',
            type: 'ChatOpenAI',
            version: 8.3,
            category: 'Chat Models',
            description: 'Wrapper around OpenAI large language models that use the Chat endpoint',
            baseClasses: ['ChatOpenAI', 'BaseChatModel', 'BaseLanguageModel', 'Runnable'],
            inputs: [
                { label: 'Cache', name: 'cache', type: 'BaseCache', optional: true },
                { label: 'Model Name', name: 'modelName', type: 'asyncOptions' },
                { label: 'Temperature', name: 'temperature', type: 'number', optional: true },
                { label: 'Streaming', name: 'streaming', type: 'boolean', optional: true },
                { label: 'Max Tokens', name: 'maxTokens', type: 'number', optional: true },
                { label: 'Top Probability', name: 'topP', type: 'number', optional: true },
                { label: 'Frequency Penalty', name: 'frequencyPenalty', type: 'number', optional: true },
                { label: 'Presence Penalty', name: 'presencePenalty', type: 'number', optional: true },
                { label: 'Timeout', name: 'timeout', type: 'number', optional: true },
                { label: 'BasePath', name: 'basepath', type: 'string', optional: true },
            ],
        },
    });
}
