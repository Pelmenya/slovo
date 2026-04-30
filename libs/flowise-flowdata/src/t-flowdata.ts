// =============================================================================
// Flowise flowData JSON shape (по результатам разведки real chatflow'ов).
// flowData = JSON-сериализованный { nodes: TFlowNode[], edges: TFlowEdge[] }.
// =============================================================================

export type TFlowAnchor = {
    label: string;
    name: string;
    type: string;
    description?: string;
    optional?: boolean;
    list?: boolean;
    options?: Array<{ label: string; name: string; description?: string }>;
};

export type TFlowNodeData = {
    id?: string;
    label: string;
    name: string;
    type: string;
    version: number;
    baseClasses: string[];
    category: string;
    description?: string;
    inputParams?: TFlowAnchor[];
    inputAnchors: TFlowAnchor[];
    inputs: Record<string, unknown>;
    outputAnchors: TFlowAnchor[];
    outputs?: Record<string, unknown>;
    selected?: boolean;
    icon?: string;
    badge?: string;
    credential?: TFlowAnchor;
};

export type TFlowNode = {
    id: string;
    position: { x: number; y: number };
    type: 'customNode';
    data: TFlowNodeData;
    width?: number;
    height?: number;
    selected?: boolean;
    positionAbsolute?: { x: number; y: number };
    dragging?: boolean;
};

export type TFlowEdge = {
    id: string;
    source: string;
    target: string;
    sourceHandle: string;
    targetHandle: string;
    type?: string;
    data?: Record<string, unknown>;
};

export type TFlowData = {
    nodes: TFlowNode[];
    edges: TFlowEdge[];
};

// =============================================================================
// Builder input — описание ноды через factory или введение
// =============================================================================

export type TBuilderNode = {
    id: string;
    node: TFlowNode;
};

export type TBuilderEdgeSpec = {
    source: string;
    target: string;
    sourceAnchor?: string;
    targetAnchor: string;
};

// =============================================================================
// Node spec из Flowise REST (GET /api/v1/nodes/:name) — для introspection
// =============================================================================

export type TFlowiseNodeSpec = {
    label: string;
    name: string;
    version: number;
    type: string;
    icon?: string;
    category: string;
    description?: string;
    baseClasses: string[];
    inputs?: TFlowAnchor[];
    outputs?: TFlowAnchor[];
    credential?: TFlowAnchor;
};
