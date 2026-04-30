import { DEFAULT_POSITION, nodeFromSpec } from './nodes-base';
import type { TFlowiseNodeSpec } from './t-flowdata';

// =============================================================================
// Прямые юнит-тесты на nodes-base — конструктор TFlowNode из spec.
// Покрытие: маппинг полей, разделение inputs на anchors vs params,
// FLOWISE_CREDENTIAL_ID, дефолтная position, дефолтный output anchor.
// =============================================================================

describe('nodes-base', () => {
    describe('DEFAULT_POSITION', () => {
        it('экспортирован и равен { x: 0, y: 0 }', () => {
            expect(DEFAULT_POSITION).toEqual({ x: 0, y: 0 });
        });
    });

    describe('nodeFromSpec', () => {
        const minimalSpec: TFlowiseNodeSpec = {
            label: 'Minimal',
            name: 'minimal',
            type: 'Minimal',
            version: 1,
            category: 'Test',
            baseClasses: ['Minimal', 'Runnable'],
        };

        it('собирает базовые поля TFlowNode из spec (id, type, label, name, version, baseClasses, category)', () => {
            const node = nodeFromSpec({ id: 'n1', spec: minimalSpec });

            expect(node.id).toBe('n1');
            expect(node.type).toBe('customNode');
            expect(node.data.id).toBe('n1');
            expect(node.data.label).toBe('Minimal');
            expect(node.data.name).toBe('minimal');
            expect(node.data.type).toBe('Minimal');
            expect(node.data.version).toBe(1);
            expect(node.data.baseClasses).toEqual(['Minimal', 'Runnable']);
            expect(node.data.category).toBe('Test');
        });

        it('position по умолчанию = DEFAULT_POSITION если не передан', () => {
            const node = nodeFromSpec({ id: 'n1', spec: minimalSpec });
            expect(node.position).toEqual(DEFAULT_POSITION);
            expect(node.position).toBe(DEFAULT_POSITION);
        });

        it('position проброшен из params', () => {
            const node = nodeFromSpec({
                id: 'n1',
                spec: minimalSpec,
                position: { x: 100, y: 200 },
            });
            expect(node.position).toEqual({ x: 100, y: 200 });
        });

        it('description проброшен из spec', () => {
            const node = nodeFromSpec({
                id: 'n1',
                spec: { ...minimalSpec, description: 'тестовое описание' },
            });
            expect(node.data.description).toBe('тестовое описание');
        });

        it('inputs (form values от пользователя) попадают в data.inputs', () => {
            const node = nodeFromSpec({
                id: 'n1',
                spec: minimalSpec,
                inputs: { foo: 'bar', count: 42, flag: true },
            });
            expect(node.data.inputs.foo).toBe('bar');
            expect(node.data.inputs.count).toBe(42);
            expect(node.data.inputs.flag).toBe(true);
        });

        it('пустые inputs дают пустой объект data.inputs', () => {
            const node = nodeFromSpec({ id: 'n1', spec: minimalSpec });
            expect(node.data.inputs).toEqual({});
        });

        it('credential попадает в inputs.FLOWISE_CREDENTIAL_ID', () => {
            const node = nodeFromSpec({
                id: 'n1',
                spec: minimalSpec,
                credential: 'cred-xyz',
            });
            expect(node.data.inputs.FLOWISE_CREDENTIAL_ID).toBe('cred-xyz');
        });

        it('credential НЕ затирает остальные inputs', () => {
            const node = nodeFromSpec({
                id: 'n1',
                spec: minimalSpec,
                inputs: { foo: 'bar' },
                credential: 'cred-xyz',
            });
            expect(node.data.inputs.foo).toBe('bar');
            expect(node.data.inputs.FLOWISE_CREDENTIAL_ID).toBe('cred-xyz');
        });

        it('credential отсутствует → FLOWISE_CREDENTIAL_ID не появляется', () => {
            const node = nodeFromSpec({ id: 'n1', spec: minimalSpec });
            expect(node.data.inputs.FLOWISE_CREDENTIAL_ID).toBeUndefined();
        });

        it('credential из spec (decorator) проброшен в data.credential', () => {
            const credSpec: TFlowiseNodeSpec = {
                ...minimalSpec,
                credential: { label: 'Credential', name: 'credential', type: 'credential' },
            };
            const node = nodeFromSpec({ id: 'n1', spec: credSpec });
            expect(node.data.credential).toEqual({
                label: 'Credential',
                name: 'credential',
                type: 'credential',
            });
        });

        it('outputs из spec используются если заданы явно', () => {
            const specWithOutputs: TFlowiseNodeSpec = {
                ...minimalSpec,
                outputs: [
                    { label: 'Output', name: 'output', type: 'options' },
                ],
            };
            const node = nodeFromSpec({ id: 'n1', spec: specWithOutputs });
            expect(node.data.outputAnchors).toEqual([
                { label: 'Output', name: 'output', type: 'options' },
            ]);
        });

        it('outputs не заданы → buildDefaultOutputAnchor строит anchor с baseClasses.join(" | ")', () => {
            const node = nodeFromSpec({ id: 'n1', spec: minimalSpec });
            expect(node.data.outputAnchors).toEqual([
                { label: 'Minimal', name: 'minimal', type: 'Minimal | Runnable' },
            ]);
        });
    });

    describe('isAnchor distinction (через nodeFromSpec)', () => {
        it('миксованные inputs корректно делятся на 2 anchor + 2 param', () => {
            const mixedSpec: TFlowiseNodeSpec = {
                label: 'Mixed',
                name: 'mixed',
                type: 'Mixed',
                version: 1,
                category: 'Test',
                baseClasses: ['Mixed'],
                inputs: [
                    { label: 'Document', name: 'document', type: 'Document' },
                    { label: 'Text Param', name: 'text', type: 'string' },
                    { label: 'Flag', name: 'flag', type: 'boolean' },
                    { label: 'Embeddings', name: 'embeddings', type: 'Embeddings' },
                ],
            };
            const node = nodeFromSpec({ id: 'n1', spec: mixedSpec });

            expect(node.data.inputAnchors).toHaveLength(2);
            expect(node.data.inputAnchors.map((a) => a.name)).toEqual([
                'document',
                'embeddings',
            ]);

            expect(node.data.inputParams).toHaveLength(2);
            expect(node.data.inputParams?.map((p) => p.name)).toEqual([
                'text',
                'flag',
            ]);
        });

        it('inputs отсутствуют в spec → inputAnchors и inputParams пустые', () => {
            const node = nodeFromSpec({ id: 'n1', spec: { ...{
                label: 'X', name: 'x', type: 'X', version: 1,
                category: 'C', baseClasses: ['X'],
            } } });
            expect(node.data.inputAnchors).toEqual([]);
            expect(node.data.inputParams).toEqual([]);
        });

        // Anchor-types проверяем по одному кейсу на каждый — фиксируем что
        // FORM_INPUT_TYPES не расширился случайно и не проглотил доменные типы.
        const anchorTypeCases: ReadonlyArray<{ kind: string; type: string }> = [
            { kind: 'BaseChatModel', type: 'BaseChatModel' },
            { kind: 'Embeddings', type: 'Embeddings' },
            { kind: 'Document', type: 'Document' },
            { kind: 'BaseMemory', type: 'BaseMemory' },
            { kind: 'BaseRetriever', type: 'BaseRetriever' },
            { kind: 'RecordManager', type: 'RecordManager' },
            { kind: 'TextSplitter', type: 'TextSplitter' },
            { kind: 'Tool', type: 'Tool' },
            { kind: 'BaseLanguageModel', type: 'BaseLanguageModel' },
            { kind: 'BaseCache', type: 'BaseCache' },
            { kind: 'BasePromptTemplate', type: 'BasePromptTemplate' },
            { kind: 'Moderation', type: 'Moderation' },
        ];

        it.each(anchorTypeCases)('тип $kind идёт в inputAnchors', ({ type }) => {
            const node = nodeFromSpec({
                id: 'n1',
                spec: {
                    label: 'X', name: 'x', type: 'X', version: 1,
                    category: 'C', baseClasses: ['X'],
                    inputs: [{ label: 'In', name: 'in', type }],
                },
            });
            expect(node.data.inputAnchors).toHaveLength(1);
            expect(node.data.inputAnchors[0]?.type).toBe(type);
            expect(node.data.inputParams).toHaveLength(0);
        });

        // Form input types — тоже по кейсу на каждый, фиксируем что список
        // FORM_INPUT_TYPES не сжался случайно (потеря типа = anchor вместо param).
        const formInputTypeCases: ReadonlyArray<string> = [
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
        ];

        it.each(formInputTypeCases)('тип "%s" идёт в inputParams', (type) => {
            const node = nodeFromSpec({
                id: 'n1',
                spec: {
                    label: 'X', name: 'x', type: 'X', version: 1,
                    category: 'C', baseClasses: ['X'],
                    inputs: [{ label: 'In', name: 'in', type }],
                },
            });
            expect(node.data.inputParams).toHaveLength(1);
            expect(node.data.inputParams?.[0]?.type).toBe(type);
            expect(node.data.inputAnchors).toHaveLength(0);
        });
    });

    describe('edge case: пустой baseClasses', () => {
        // Документируем известное поведение: при пустом baseClasses
        // дефолтный output anchor получает type = "" (пустая строка).
        // Это потенциальный баг — Flowise может не уметь подключать к anchor
        // без типа. См. финальный отчёт.
        it('пустой baseClasses + нет outputs → output anchor.type = ""', () => {
            const node = nodeFromSpec({
                id: 'n1',
                spec: {
                    label: 'Empty',
                    name: 'empty',
                    type: 'Empty',
                    version: 1,
                    category: 'Test',
                    baseClasses: [],
                },
            });
            expect(node.data.outputAnchors).toEqual([
                { label: 'Empty', name: 'empty', type: '' },
            ]);
        });
    });
});
