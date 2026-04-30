import { nodeFromSpec } from '../nodes-base';
import type { TFlowAnchor, TFlowNode, TFlowiseNodeSpec } from '../t-flowdata';

// =============================================================================
// genericNode — fallback для нод без typed factory.
//
// Принимает spec вручную (полный TFlowiseNodeSpec со всеми полями) и собирает
// TFlowNode через общий nodeFromSpec. Не даёт TS-типизации inputs
// (Record<string, unknown>), но работает для всех 200+ нод Flowise.
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
// fromIntrospection — построение node из MCP nodes_get response.
//
// MCP `flowise_nodes_get` возвращает node-spec с полями label/name/version/type/
// category/baseClasses/inputs/outputs/credential. Структура совместима с
// TFlowiseNodeSpec — но MCP может вернуть partial-spec (например, без
// outputs если у ноды дефолтный output). Здесь мы нормализуем недостающие
// поля и пробрасываем в genericNode.
//
// Использование с @slovo/mcp-flowise:
//
//     const got = await flowise.nodes_get({ name: 'chatGoogleGenerativeAI' });
//     if (!got.success) throw ...;
//     const node = fromIntrospection({
//         id: 'gemini',
//         spec: got.data,                        // TFlowiseNodeSpec совместим
//         inputs: { modelName: 'gemini-2.0-flash', temperature: 0.5 },
//     });
//
// Покрывает абсолютно все ноды Flowise (включая редкие/новые) без
// захардкоживания в этой либе.
// =============================================================================

export type TFromIntrospectionParams = {
    id: string;
    spec: TFlowiseNodeSpec;
    inputs?: Record<string, unknown>;
    credential?: string;
    position?: { x: number; y: number };
};

export function fromIntrospection(params: TFromIntrospectionParams): TFlowNode {
    const normalizedSpec = normalizeIntrospectionSpec(params.spec);
    return genericNode({
        id: params.id,
        spec: normalizedSpec,
        inputs: params.inputs,
        credential: params.credential,
        position: params.position,
    });
}

// =============================================================================
// normalizeIntrospectionSpec — заполняет недостающие поля spec'а полученного
// через MCP nodes_get / Flowise REST. Нужен потому что REST может вернуть
// partial shape: например inputs может быть undefined у нод без параметров,
// а baseClasses может прийти пустым массивом для абстрактных нод.
//
// Возвращает spec с гарантированно непустыми массивами и default outputs.
// =============================================================================

function normalizeIntrospectionSpec(spec: TFlowiseNodeSpec): TFlowiseNodeSpec {
    const baseClasses = spec.baseClasses.length > 0 ? spec.baseClasses : [spec.type];
    return {
        ...spec,
        baseClasses,
        inputs: spec.inputs ?? [],
        outputs: spec.outputs ?? buildDefaultOutputAnchorList(spec, baseClasses),
    };
}

function buildDefaultOutputAnchorList(
    spec: TFlowiseNodeSpec,
    baseClasses: string[],
): TFlowAnchor[] {
    return [
        {
            label: spec.label,
            name: spec.name,
            type: baseClasses.join(' | '),
        },
    ];
}
