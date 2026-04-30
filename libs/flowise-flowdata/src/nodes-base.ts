import type { TFlowAnchor, TFlowNode, TFlowiseNodeSpec } from './t-flowdata';

// =============================================================================
// Дефолтная position. Flowise сам разводит ноды при импорте — точные
// координаты не критичны, можно сваливать в одну точку.
// =============================================================================

export const DEFAULT_POSITION = { x: 0, y: 0 } as const;

// =============================================================================
// Builder helper: nodeFromSpec — собирает TFlowNode из node-spec (spec может
// прийти от runtime introspection через MCP nodes_get, или захардкожен).
// =============================================================================

export type TNodeFromSpecParams = {
    id: string;
    spec: TFlowiseNodeSpec;
    inputs?: Record<string, unknown>;
    position?: { x: number; y: number };
    credential?: string;
};

export function nodeFromSpec(params: TNodeFromSpecParams): TFlowNode {
    const { id, spec, inputs = {}, position, credential } = params;

    const inputAnchors = (spec.inputs ?? []).filter(isAnchor);
    const inputParams = (spec.inputs ?? []).filter((i) => !isAnchor(i));
    const outputAnchors = spec.outputs ?? buildDefaultOutputAnchor(spec);

    const finalInputs: Record<string, unknown> = { ...inputs };
    if (credential !== undefined) {
        finalInputs.FLOWISE_CREDENTIAL_ID = credential;
    }

    return {
        id,
        type: 'customNode',
        position: position ?? DEFAULT_POSITION,
        data: {
            id,
            label: spec.label,
            name: spec.name,
            type: spec.type,
            version: spec.version,
            baseClasses: spec.baseClasses,
            category: spec.category,
            description: spec.description,
            inputParams,
            inputAnchors,
            inputs: finalInputs,
            outputAnchors,
            credential: spec.credential,
        },
    };
}

// =============================================================================
// Распознаём anchor vs form-input. Anchors — те поля, тип которых
// соответствует типу выхода другой ноды (Document, Embeddings, BaseChatModel,
// Memory, Tool, etc). Form-inputs — string/number/boolean/options/json/etc.
// =============================================================================

const FORM_INPUT_TYPES = new Set([
    'string',
    'number',
    'boolean',
    'options',
    'multiOptions',
    'asyncOptions',
    'asyncMultiOptions',
    'json',
    'code',
    'datagrid',
    'file',
    'folder',
    'password',
    'tabs',
    'array',
    'credential',
]);

function isAnchor(input: TFlowAnchor): boolean {
    return !FORM_INPUT_TYPES.has(input.type);
}

function buildDefaultOutputAnchor(spec: TFlowiseNodeSpec): TFlowAnchor[] {
    return [
        {
            label: spec.label,
            name: spec.name,
            type: spec.baseClasses.join(' | '),
        },
    ];
}
