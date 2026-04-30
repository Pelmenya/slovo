import { nodeFromSpec } from '../nodes-base';
import type { TFlowNode } from '../t-flowdata';

// =============================================================================
// conversationalRetrievalQAChain — RAG-цепочка с историей диалога
// =============================================================================

export type TConversationalRetrievalQAChainInputs = {
    returnSourceDocuments?: boolean;
    rephrasePrompt?: string;
    responsePrompt?: string;
};

export type TConversationalRetrievalQAChainParams = {
    id: string;
    inputs?: TConversationalRetrievalQAChainInputs;
    position?: { x: number; y: number };
};

export function conversationalRetrievalQAChain(
    params: TConversationalRetrievalQAChainParams,
): TFlowNode {
    return nodeFromSpec({
        id: params.id,
        position: params.position,
        inputs: params.inputs,
        spec: {
            label: 'Conversational Retrieval QA Chain',
            name: 'conversationalRetrievalQAChain',
            type: 'ConversationalRetrievalQAChain',
            version: 3,
            category: 'Chains',
            description: 'Document QA - cited sources + chat history with vector store retriever',
            baseClasses: ['ConversationalRetrievalQAChain', 'BaseChain', 'Runnable'],
            inputs: [
                { label: 'Chat Model', name: 'model', type: 'BaseChatModel' },
                { label: 'Vector Store Retriever', name: 'vectorStoreRetriever', type: 'BaseRetriever' },
                { label: 'Memory', name: 'memory', type: 'BaseMemory' },
                { label: 'Return Source Documents', name: 'returnSourceDocuments', type: 'boolean', optional: true },
                { label: 'Rephrase Prompt', name: 'rephrasePrompt', type: 'string', optional: true },
                { label: 'Response Prompt', name: 'responsePrompt', type: 'string', optional: true },
                { label: 'Input Moderation', name: 'inputModeration', type: 'Moderation', optional: true, list: true },
            ],
        },
    });
}

// =============================================================================
// llmChain — простая цепочка prompt → LLM
// =============================================================================

export type TLLMChainInputs = {
    chainName?: string;
    promptValues?: string;
};

export type TLLMChainParams = {
    id: string;
    inputs?: TLLMChainInputs;
    position?: { x: number; y: number };
};

export function llmChain(params: TLLMChainParams): TFlowNode {
    return nodeFromSpec({
        id: params.id,
        position: params.position,
        inputs: params.inputs,
        spec: {
            label: 'LLM Chain',
            name: 'llmChain',
            type: 'LLMChain',
            version: 3,
            category: 'Chains',
            description: 'Chain to run queries against LLMs',
            baseClasses: ['LLMChain', 'BaseChain', 'Runnable'],
            inputs: [
                { label: 'Language Model', name: 'model', type: 'BaseLanguageModel' },
                { label: 'Prompt', name: 'prompt', type: 'BasePromptTemplate' },
                { label: 'Output Parser', name: 'outputParser', type: 'BaseLLMOutputParser', optional: true },
                { label: 'Input Moderation', name: 'inputModeration', type: 'Moderation', optional: true, list: true },
                { label: 'Chain Name', name: 'chainName', type: 'string', optional: true },
            ],
        },
    });
}
