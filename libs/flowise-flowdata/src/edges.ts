import type { TBuilderEdgeSpec, TFlowEdge, TFlowNode } from './t-flowdata';

// =============================================================================
// Edge handle string formula:
// sourceHandle = "<nodeId>-output-<anchorName>-<anchorType>"
// targetHandle = "<nodeId>-input-<anchorName>-<anchorType>"
//
// Где anchorType — конкатенация baseClasses через "|".
// =============================================================================

// Тип edge'ов в Flowise — на момент 3.x всегда "buttonedge". В ранних версиях
// был "default". Если Flowise schema меняется — правим тут одно место.
export const FLOWISE_EDGE_TYPE = 'buttonedge' as const;

function findAnchor(
    anchors: TFlowNode['data']['inputAnchors'] | TFlowNode['data']['outputAnchors'],
    name?: string,
): TFlowNode['data']['inputAnchors'][number] | undefined {
    if (anchors.length === 0) {
        return undefined;
    }
    if (name) {
        return anchors.find((a) => a.name === name);
    }
    return anchors[0];
}

export function makeSourceHandle(node: TFlowNode, anchorName?: string): string {
    const anchor = findAnchor(node.data.outputAnchors, anchorName);
    if (!anchor) {
        throw new Error(
            `Node ${node.id} has no output anchor${anchorName ? ` named "${anchorName}"` : ''}`,
        );
    }
    if (!anchor.type) {
        throw new Error(
            `Node ${node.id} output anchor "${anchor.name}" has empty type — likely empty baseClasses in spec`,
        );
    }
    return `${node.id}-output-${anchor.name}-${anchor.type}`;
}

export function makeTargetHandle(node: TFlowNode, anchorName: string): string {
    const anchor = findAnchor(node.data.inputAnchors, anchorName);
    if (!anchor) {
        throw new Error(`Node ${node.id} has no input anchor named "${anchorName}"`);
    }
    if (!anchor.type) {
        throw new Error(
            `Node ${node.id} input anchor "${anchor.name}" has empty type`,
        );
    }
    return `${node.id}-input-${anchor.name}-${anchor.type}`;
}

export function buildEdge(
    spec: TBuilderEdgeSpec,
    nodes: Record<string, TFlowNode>,
): TFlowEdge {
    const sourceNode = nodes[spec.source];
    const targetNode = nodes[spec.target];
    if (!sourceNode) {
        throw new Error(`Edge source node "${spec.source}" not found`);
    }
    if (!targetNode) {
        throw new Error(`Edge target node "${spec.target}" not found`);
    }
    const sourceHandle = makeSourceHandle(sourceNode, spec.sourceAnchor);
    const targetHandle = makeTargetHandle(targetNode, spec.targetAnchor);
    return {
        id: `${sourceHandle}-${targetHandle}`,
        source: sourceNode.id,
        target: targetNode.id,
        sourceHandle,
        targetHandle,
        type: FLOWISE_EDGE_TYPE,
    };
}
