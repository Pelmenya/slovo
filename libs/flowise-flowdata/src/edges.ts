import type { TBuilderEdgeSpec, TFlowEdge, TFlowNode } from './t-flowdata';

// =============================================================================
// Edge handle string formula:
// sourceHandle = "<nodeId>-output-<anchorName>-<anchorType>"
// targetHandle = "<nodeId>-input-<anchorName>-<anchorType>"
//
// Где anchorType — конкатенация baseClasses через "|".
// =============================================================================

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
    return `${node.id}-output-${anchor.name}-${anchor.type}`;
}

export function makeTargetHandle(node: TFlowNode, anchorName: string): string {
    const anchor = findAnchor(node.data.inputAnchors, anchorName);
    if (!anchor) {
        throw new Error(`Node ${node.id} has no input anchor named "${anchorName}"`);
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
        type: 'buttonedge',
    };
}
