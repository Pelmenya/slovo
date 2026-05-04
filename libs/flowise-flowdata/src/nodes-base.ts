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

    const rawInputAnchors = (spec.inputs ?? []).filter(isAnchor);
    const rawInputParams = (spec.inputs ?? []).filter((i) => !isAnchor(i));
    const rawOutputAnchors = spec.outputs ?? buildDefaultOutputAnchor(spec);

    // Если у spec есть credential descriptor — он попадает в inputParams как form
    // dropdown (Flowise UI рендерит его наряду с остальными form fields). Без этого
    // в UI отсутствует поле "Connect Credential". Catalog-augmenter тому прецедент:
    // его inputParams содержат entry { name:'credential', type:'credential', display: true }.
    // display: true заставляет UI отрисовать dropdown.
    const credentialAsParam: TFlowAnchor[] = spec.credential
        ? [{ ...spec.credential, display: true } as TFlowAnchor & { display: boolean }]
        : [];

    // Каждому anchor требуется поле `id` — это React Flow handle ID, по которому
    // edge.sourceHandle / edge.targetHandle сматчиваются с handle elements в node.
    // Без id UI рендерит ноды, но edges НЕ рисует. Прецедент 2026-05-04 при
    // создании water-analysis-extractor-vision-v1.
    const inputAnchors = rawInputAnchors.map((a) => normalizeAnchor(a, id, 'input'));
    const inputParams = [...credentialAsParam, ...rawInputParams].map((a) => normalizeAnchor(a, id, 'input'));
    const outputAnchors = rawOutputAnchors.map((a) => normalizeAnchor(a, id, 'output'));

    // Form inputs (string/number/boolean/options) должны присутствовать в data.inputs
    // ВСЕ — даже не заданные пользователем. Flowise UI иначе не рендерит form fields
    // (например, asyncOptions для Model Name остаётся пустым). Catalog-augmenter тому
    // прецедент: его inputs содержат cache="", extendedThinking="", topP="" и т.д.
    // Прецедент 2026-05-04: на water-analysis-extractor-vision-v1 поле Model Name
    // отображалось пустым в UI несмотря на корректный modelName в data.inputs.
    const finalInputs: Record<string, unknown> = { ...inputs };
    for (const param of inputParams) {
        if (param.name === 'credential') continue; // credential идёт через FLOWISE_CREDENTIAL_ID
        if (param.name in finalInputs) continue;
        const paramAsLoose = param as TFlowAnchor & { default?: unknown };
        if (paramAsLoose.default !== undefined) {
            finalInputs[param.name] = paramAsLoose.default;
            continue;
        }
        finalInputs[param.name] = param.type === 'boolean' ? false : '';
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
            // outputs: {} — обязателен в data, не undefined. Runtime некоторых нод
            // (LLMChain) читает nodeData.outputs?.output с optional chaining,
            // но другие части runtime ожидают что outputs существует. Catalog
            // тому прецедент: все ноды имеют data.outputs = {}.
            outputs: {},
            // data.credential — string ID выбранного credential (не spec object).
            // Catalog-augmenter тому прецедент: data.credential = "d5e595c0-..." (UUID).
            // Без этого UI dropdown Connect Credential показывается пустым,
            // даже если credential передан. Прецедент 2026-05-04.
            // Раньше factory ставила `data.credential = spec.credential` (spec object) и
            // дополнительно `inputs.FLOWISE_CREDENTIAL_ID = id` — оба формата неверны.
            credential: credential,
        },
    };
}

// =============================================================================
// Anchor normalization: добавляем id, синтезируем type из baseClasses если type
// отсутствует. Спеки нод из Flowise REST приходят с разной shape'ой:
//   - Большинство нод: outputs/inputs с полем `type: 'ChatAnthropic | ...'`
//   - LLMChain и другие chain-ноды: `outputs: [{ label, name, baseClasses }]`
//     (массив строк baseClasses, без поля type)
// nodeFromSpec унифицирует оба формата так чтобы UI Flowise всегда находил handle.
// =============================================================================

function normalizeAnchor(anchor: TFlowAnchor, nodeId: string, direction: 'input' | 'output'): TFlowAnchor {
    const anchorAsLoose = anchor as TFlowAnchor & { id?: string; baseClasses?: string[] };
    const synthesizedType =
        anchor.type ??
        (Array.isArray(anchorAsLoose.baseClasses) && anchorAsLoose.baseClasses.length > 0
            ? anchorAsLoose.baseClasses.join(' | ')
            : '');
    const compactType = synthesizedType.replace(/ \| /g, '|');
    const id = anchorAsLoose.id ?? `${nodeId}-${direction}-${anchor.name}-${compactType}`;

    return {
        ...anchor,
        type: synthesizedType,
        id,
    } as TFlowAnchor;
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
