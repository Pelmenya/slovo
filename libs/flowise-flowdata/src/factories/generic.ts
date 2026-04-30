import { nodeFromSpec } from '../nodes-base';
import type { TFlowNode, TFlowiseNodeSpec } from '../t-flowdata';

// =============================================================================
// genericNode — fallback для нод без typed factory.
//
// Принимает spec вручную или полученный через runtime introspection
// (flowise_nodes_get из @slovo/mcp-flowise). Не даёт TS-типизации
// inputs (Record<string, unknown>), но работает для всех 200+ нод Flowise.
// =============================================================================

export type TGenericNodeParams = {
    id: string;
    spec: TFlowiseNodeSpec;
    inputs?: Record<string, unknown>;
    credential?: string;
    position?: { x: number; y: number };
};

export function genericNode(params: TGenericNodeParams): TFlowNode {
    return nodeFromSpec({
        id: params.id,
        spec: params.spec,
        inputs: params.inputs,
        credential: params.credential,
        position: params.position,
    });
}

// =============================================================================
// fromIntrospection — динамическое построение node из MCP nodes_get response.
//
// Использование (с @slovo/mcp-flowise):
//
// const nodeSpec = await flowise.nodes_get({ name: 'chatGoogleGenerativeAI' });
// if (!nodeSpec.success) throw ...;
// const node = fromIntrospection({
//     id: 'gemini',
//     spec: nodeSpec.data,
//     inputs: { modelName: 'gemini-2.0-flash', temperature: 0.5 },
// });
//
// Это покрывает абсолютно все ноды Flowise (включая редкие/новые)
// без захардкоживания в этой либе.
// =============================================================================

export const fromIntrospection = genericNode;
