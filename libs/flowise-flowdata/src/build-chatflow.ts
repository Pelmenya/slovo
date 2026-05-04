import { buildEdge } from './edges';
import type { TBuilderEdgeSpec, TFlowData, TFlowNode } from './t-flowdata';

export type TBuildChatflowParams = {
    nodes: TFlowNode[];
    edges?: TBuilderEdgeSpec[];
};

// =============================================================================
// buildChatflow — собирает финальный TFlowData JSON из массивов nodes + edges.
// Возвращает объект, который можно JSON.stringify и отдать в
// flowise_chatflow_create({ flowData: JSON.stringify(result) }).
// =============================================================================

export function buildChatflow(params: TBuildChatflowParams): TFlowData {
    const { nodes, edges = [] } = params;
    const seen = new Set<string>();
    for (const n of nodes) {
        if (seen.has(n.id)) {
            throw new Error(`Duplicate node id: ${n.id}`);
        }
        seen.add(n.id);
    }
    const nodesById: Record<string, TFlowNode> = {};
    for (const n of nodes) {
        nodesById[n.id] = n;
    }
    const builtEdges = edges.map((e) => buildEdge(e, nodesById));

    // Прописываем template references в inputs target-нод по edges. Flowise
    // runtime читает `nodeData.inputs.<anchorName>` ожидая строку
    // `{{<sourceNodeId>.data.instance}}` — этот формат разрешается в runtime
    // в actual instance source-ноды. Без этого LLM Chain ругается
    // `Cannot read properties of undefined (reading 'promptValues')`,
    // ConversationChain — `model is required`. Прецедент 2026-05-04.
    // Catalog-augmenter тому пример: его conversationChain inputs содержат
    // model: "{{chatAnthropic_0.data.instance}}", memory: "{{bufferWindowMemory_0.data.instance}}".
    for (const edgeSpec of edges) {
        const target = nodesById[edgeSpec.target];
        if (!target) continue;
        target.data.inputs[edgeSpec.targetAnchor] = `{{${edgeSpec.source}.data.instance}}`;
    }

    return { nodes, edges: builtEdges };
}

// =============================================================================
// serializeFlowData — convenience wrapper для chatflow_create:
// serializeFlowData(buildChatflow(...)) → string ready для flowData field.
// =============================================================================

export function serializeFlowData(data: TFlowData): string {
    return JSON.stringify(data);
}
