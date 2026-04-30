import { fromIntrospection, genericNode } from './generic';
import type { TFlowiseNodeSpec } from '../t-flowdata';

const FULL_SPEC: TFlowiseNodeSpec = {
    label: 'Custom Node',
    name: 'customNode',
    type: 'CustomNode',
    version: 1,
    category: 'Custom',
    description: 'Test',
    baseClasses: ['CustomNode', 'BaseClass'],
    inputs: [
        { label: 'Model', name: 'model', type: 'BaseChatModel' },
        { label: 'Temperature', name: 'temperature', type: 'number', optional: true },
    ],
    outputs: [{ label: 'Out', name: 'out', type: 'CustomNode | BaseClass' }],
};

describe('genericNode', () => {
    it('собирает TFlowNode из полного spec', () => {
        const node = genericNode({ id: 'gen-1', spec: FULL_SPEC, inputs: { temperature: 0.5 } });
        expect(node.id).toBe('gen-1');
        expect(node.data.name).toBe('customNode');
        expect(node.data.version).toBe(1);
        expect(node.data.baseClasses).toEqual(['CustomNode', 'BaseClass']);
        expect(node.data.inputs.temperature).toBe(0.5);
    });

    it('credential попадает в inputs.FLOWISE_CREDENTIAL_ID', () => {
        const node = genericNode({ id: 'gen-1', spec: FULL_SPEC, credential: 'cred-x' });
        expect(node.data.inputs.FLOWISE_CREDENTIAL_ID).toBe('cred-x');
    });
});

describe('fromIntrospection', () => {
    it('работает с полным spec (как genericNode)', () => {
        const node = fromIntrospection({
            id: 'intro-1',
            spec: FULL_SPEC,
            inputs: { temperature: 0.7 },
        });
        expect(node.id).toBe('intro-1');
        expect(node.data.inputs.temperature).toBe(0.7);
        // outputs из spec'а сохранены
        expect(node.data.outputAnchors).toHaveLength(1);
        expect(node.data.outputAnchors[0]?.type).toBe('CustomNode | BaseClass');
    });

    it('partial spec без inputs — нормализует в []', () => {
        const partialSpec: TFlowiseNodeSpec = {
            label: 'Partial',
            name: 'partial',
            type: 'PartialType',
            version: 1,
            category: 'Misc',
            baseClasses: ['PartialType'],
            // inputs отсутствует
        };
        const node = fromIntrospection({ id: 'p-1', spec: partialSpec });
        expect(node.data.inputAnchors).toEqual([]);
        expect(node.data.inputParams).toEqual([]);
    });

    it('partial spec без outputs — генерирует default output anchor из baseClasses', () => {
        const noOutputsSpec: TFlowiseNodeSpec = {
            label: 'NoOutputs',
            name: 'noOutputs',
            type: 'NoOutputsType',
            version: 2,
            category: 'Misc',
            baseClasses: ['ClassA', 'ClassB', 'ClassC'],
            inputs: [{ label: 'X', name: 'x', type: 'string' }],
            // outputs отсутствует
        };
        const node = fromIntrospection({ id: 'no-1', spec: noOutputsSpec });
        expect(node.data.outputAnchors).toHaveLength(1);
        const out = node.data.outputAnchors[0];
        expect(out?.label).toBe('NoOutputs');
        expect(out?.name).toBe('noOutputs');
        expect(out?.type).toBe('ClassA | ClassB | ClassC');
    });

    it('пустой baseClasses — fallback на тип ноды (избегаем empty anchor.type)', () => {
        const noBaseClassesSpec: TFlowiseNodeSpec = {
            label: 'Empty',
            name: 'empty',
            type: 'EmptyType',
            version: 1,
            category: 'Misc',
            baseClasses: [],
            inputs: [],
        };
        const node = fromIntrospection({ id: 'e-1', spec: noBaseClassesSpec });
        // baseClasses нормализован в [type]
        expect(node.data.baseClasses).toEqual(['EmptyType']);
        // output anchor имеет non-empty type — edge formula теперь не будет иметь trailing dash
        expect(node.data.outputAnchors[0]?.type).toBe('EmptyType');
    });

    it('input типа anchor (не form-input) корректно идёт в inputAnchors', () => {
        const node = fromIntrospection({ id: 'a-1', spec: FULL_SPEC });
        expect(node.data.inputAnchors).toHaveLength(1);
        expect(node.data.inputAnchors[0]?.name).toBe('model');
        expect(node.data.inputParams).toHaveLength(1);
        expect(node.data.inputParams?.[0]?.name).toBe('temperature');
    });
});
