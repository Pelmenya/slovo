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
    return { nodes, edges: builtEdges };
}

// =============================================================================
// serializeFlowData — convenience wrapper для chatflow_create:
// serializeFlowData(buildChatflow(...)) → string ready для flowData field.
// =============================================================================

export function serializeFlowData(data: TFlowData): string {
    return JSON.stringify(data);
}
