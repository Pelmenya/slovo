import { chatAnthropic, chatOpenAI } from './chat-models';
import { openAIEmbeddings } from './embeddings';
import { recursiveCharacterTextSplitter } from './splitters';
import { postgresVectorStore, documentStoreVS } from './vectorstores';
import { conversationalRetrievalQAChain, llmChain } from './chains';
import { bufferMemory, bufferWindowMemory } from './memory';
import { jsonFile, s3File } from './loaders';

// =============================================================================
// Юнит-тесты на factory-функции. Цель — зафиксировать version / baseClasses /
// category / разделение inputs ↔ anchors. Если разработчик опечатается
// в spec'е или Flowise обновит схему — тест упадёт точечно.
// =============================================================================

describe('factories', () => {
    describe('chatAnthropic', () => {
        const node = chatAnthropic({ id: 'llm' });

        it('базовые поля spec', () => {
            expect(node.id).toBe('llm');
            expect(node.data.name).toBe('chatAnthropic');
            expect(node.data.label).toBe('ChatAnthropic');
            expect(node.data.type).toBe('ChatAnthropic');
            expect(node.data.version).toBe(8);
            expect(node.data.category).toBe('Chat Models');
        });

        it('baseClasses точный массив', () => {
            expect(node.data.baseClasses).toEqual([
                'ChatAnthropic',
                'ChatAnthropicMessages',
                'BaseChatModel',
                'BaseLanguageModel',
                'Runnable',
            ]);
        });

        it('cache (BaseCache) — anchor, modelName/temperature/etc — params', () => {
            expect(node.data.inputAnchors.map((a) => a.name)).toEqual(['cache']);
            expect(node.data.inputAnchors[0]?.type).toBe('BaseCache');

            const paramNames = node.data.inputParams?.map((p) => p.name) ?? [];
            expect(paramNames).toEqual([
                'modelName',
                'temperature',
                'streaming',
                'allowImageUploads',
                'extendedThinking',
                'budgetTokens',
                'maxTokensToSample',
                'topP',
                'topK',
            ]);
        });

        it('пользовательские inputs пробрасываются', () => {
            const customNode = chatAnthropic({
                id: 'llm',
                inputs: { modelName: 'claude-sonnet-4-6', temperature: 0.3 },
                credential: 'cred-1',
            });
            expect(customNode.data.inputs.modelName).toBe('claude-sonnet-4-6');
            expect(customNode.data.inputs.temperature).toBe(0.3);
            expect(customNode.data.inputs.FLOWISE_CREDENTIAL_ID).toBe('cred-1');
        });
    });

    describe('chatOpenAI', () => {
        const node = chatOpenAI({ id: 'llm' });

        it('базовые поля spec', () => {
            expect(node.data.name).toBe('chatOpenAI');
            expect(node.data.label).toBe('OpenAI');
            expect(node.data.type).toBe('ChatOpenAI');
            expect(node.data.version).toBe(8.3);
            expect(node.data.category).toBe('Chat Models');
        });

        it('baseClasses точный массив', () => {
            expect(node.data.baseClasses).toEqual([
                'ChatOpenAI',
                'BaseChatModel',
                'BaseLanguageModel',
                'Runnable',
            ]);
        });

        it('cache — anchor, остальные — params', () => {
            expect(node.data.inputAnchors.map((a) => a.name)).toEqual(['cache']);
            const paramNames = node.data.inputParams?.map((p) => p.name) ?? [];
            expect(paramNames).toEqual([
                'modelName',
                'temperature',
                'streaming',
                'maxTokens',
                'topP',
                'frequencyPenalty',
                'presencePenalty',
                'timeout',
                'basepath',
            ]);
        });
    });

    describe('openAIEmbeddings', () => {
        const node = openAIEmbeddings({ id: 'emb' });

        it('базовые поля spec', () => {
            expect(node.data.name).toBe('openAIEmbeddings');
            expect(node.data.label).toBe('OpenAI Embeddings');
            expect(node.data.type).toBe('OpenAIEmbeddings');
            expect(node.data.version).toBe(4);
            expect(node.data.category).toBe('Embeddings');
        });

        it('baseClasses точный массив', () => {
            expect(node.data.baseClasses).toEqual(['OpenAIEmbeddings', 'Embeddings']);
        });

        it('всё — params (нет anchor inputs)', () => {
            expect(node.data.inputAnchors).toEqual([]);
            const paramNames = node.data.inputParams?.map((p) => p.name) ?? [];
            expect(paramNames).toEqual([
                'modelName',
                'stripNewLines',
                'batchSize',
                'timeout',
                'basepath',
                'dimensions',
                'encodingFormat',
            ]);
        });

        it('default output anchor строится из baseClasses', () => {
            expect(node.data.outputAnchors).toEqual([
                {
                    label: 'OpenAI Embeddings',
                    name: 'openAIEmbeddings',
                    type: 'OpenAIEmbeddings | Embeddings',
                },
            ]);
        });
    });

    describe('recursiveCharacterTextSplitter', () => {
        const node = recursiveCharacterTextSplitter({ id: 's' });

        it('базовые поля spec', () => {
            expect(node.data.name).toBe('recursiveCharacterTextSplitter');
            expect(node.data.type).toBe('RecursiveCharacterTextSplitter');
            expect(node.data.version).toBe(2);
            expect(node.data.category).toBe('Text Splitters');
        });

        it('baseClasses точный массив', () => {
            expect(node.data.baseClasses).toEqual([
                'RecursiveCharacterTextSplitter',
                'TextSplitter',
                'BaseDocumentTransformer',
                'Runnable',
            ]);
        });

        it('всё — params (chunkSize, chunkOverlap, separators)', () => {
            expect(node.data.inputAnchors).toEqual([]);
            const paramNames = node.data.inputParams?.map((p) => p.name) ?? [];
            expect(paramNames).toEqual(['chunkSize', 'chunkOverlap', 'separators']);
        });
    });

    describe('postgresVectorStore', () => {
        const node = postgresVectorStore({
            id: 'pg',
            inputs: { host: 'h', database: 'd' },
        });

        it('базовые поля spec', () => {
            expect(node.data.name).toBe('postgres');
            expect(node.data.label).toBe('Postgres');
            expect(node.data.type).toBe('Postgres');
            expect(node.data.version).toBe(9);
            expect(node.data.category).toBe('Vector Stores');
        });

        it('baseClasses точный массив', () => {
            expect(node.data.baseClasses).toEqual([
                'Postgres',
                'VectorStoreRetriever',
                'BaseRetriever',
            ]);
        });

        it('Document/Embeddings/RecordManager — anchors, host/database/port/tableName — params', () => {
            const anchorNames = node.data.inputAnchors.map((a) => a.name);
            expect(anchorNames).toEqual(['document', 'embeddings', 'recordManager']);
            expect(node.data.inputAnchors.map((a) => a.type)).toEqual([
                'Document',
                'Embeddings',
                'RecordManager',
            ]);

            const paramNames = node.data.inputParams?.map((p) => p.name) ?? [];
            expect(paramNames).toEqual([
                'host',
                'database',
                'port',
                'ssl',
                'tableName',
                'distanceStrategy',
                'fileUpload',
                'batchSize',
                'additionalConfig',
                'topK',
                'contentColumnName',
            ]);
        });

        it('явные outputs из spec используются (не дефолтный)', () => {
            expect(node.data.outputAnchors).toEqual([
                { label: 'Output', name: 'output', type: 'options' },
            ]);
        });

        it('inputs пробрасываются', () => {
            expect(node.data.inputs.host).toBe('h');
            expect(node.data.inputs.database).toBe('d');
        });
    });

    describe('documentStoreVS', () => {
        const node = documentStoreVS({ id: 'ds' });

        it('базовые поля spec', () => {
            expect(node.data.name).toBe('documentStoreVS');
            expect(node.data.type).toBe('DocumentStoreVS');
            expect(node.data.version).toBe(1);
            expect(node.data.category).toBe('Vector Stores');
        });

        it('baseClasses точный массив', () => {
            expect(node.data.baseClasses).toEqual(['DocumentStoreVS', 'BaseRetriever']);
        });

        it('selectedStore — единственный (asyncOptions param)', () => {
            expect(node.data.inputAnchors).toEqual([]);
            const paramNames = node.data.inputParams?.map((p) => p.name) ?? [];
            expect(paramNames).toEqual(['selectedStore']);
        });

        it('явные outputs', () => {
            expect(node.data.outputAnchors).toEqual([
                { label: 'Output', name: 'output', type: 'options' },
            ]);
        });
    });

    describe('conversationalRetrievalQAChain', () => {
        const node = conversationalRetrievalQAChain({ id: 'chain' });

        it('базовые поля spec', () => {
            expect(node.data.name).toBe('conversationalRetrievalQAChain');
            expect(node.data.type).toBe('ConversationalRetrievalQAChain');
            expect(node.data.version).toBe(3);
            expect(node.data.category).toBe('Chains');
        });

        it('baseClasses точный массив', () => {
            expect(node.data.baseClasses).toEqual([
                'ConversationalRetrievalQAChain',
                'BaseChain',
                'Runnable',
            ]);
        });

        it('model/vectorStoreRetriever/memory/inputModeration — anchors, prompts/flags — params', () => {
            const anchorNames = node.data.inputAnchors.map((a) => a.name);
            expect(anchorNames).toEqual([
                'model',
                'vectorStoreRetriever',
                'memory',
                'inputModeration',
            ]);
            expect(node.data.inputAnchors.map((a) => a.type)).toEqual([
                'BaseChatModel',
                'BaseRetriever',
                'BaseMemory',
                'Moderation',
            ]);

            const paramNames = node.data.inputParams?.map((p) => p.name) ?? [];
            expect(paramNames).toEqual([
                'returnSourceDocuments',
                'rephrasePrompt',
                'responsePrompt',
            ]);
        });
    });

    describe('llmChain', () => {
        const node = llmChain({ id: 'chain' });

        it('базовые поля spec', () => {
            expect(node.data.name).toBe('llmChain');
            expect(node.data.type).toBe('LLMChain');
            expect(node.data.version).toBe(3);
            expect(node.data.category).toBe('Chains');
        });

        it('baseClasses точный массив', () => {
            expect(node.data.baseClasses).toEqual(['LLMChain', 'BaseChain', 'Runnable']);
        });

        it('model/prompt/outputParser/inputModeration — anchors, chainName — param', () => {
            const anchorNames = node.data.inputAnchors.map((a) => a.name);
            expect(anchorNames).toEqual([
                'model',
                'prompt',
                'outputParser',
                'inputModeration',
            ]);
            expect(node.data.inputAnchors.map((a) => a.type)).toEqual([
                'BaseLanguageModel',
                'BasePromptTemplate',
                'BaseLLMOutputParser',
                'Moderation',
            ]);

            const paramNames = node.data.inputParams?.map((p) => p.name) ?? [];
            expect(paramNames).toEqual(['chainName']);
        });
    });

    describe('bufferMemory', () => {
        const node = bufferMemory({ id: 'mem' });

        it('базовые поля spec', () => {
            expect(node.data.name).toBe('bufferMemory');
            expect(node.data.type).toBe('BufferMemory');
            expect(node.data.version).toBe(2);
            expect(node.data.category).toBe('Memory');
        });

        it('baseClasses точный массив', () => {
            expect(node.data.baseClasses).toEqual([
                'BufferMemory',
                'BaseChatMemory',
                'BaseMemory',
            ]);
        });

        it('всё — params (sessionId, memoryKey)', () => {
            expect(node.data.inputAnchors).toEqual([]);
            const paramNames = node.data.inputParams?.map((p) => p.name) ?? [];
            expect(paramNames).toEqual(['sessionId', 'memoryKey']);
        });
    });

    describe('bufferWindowMemory', () => {
        const node = bufferWindowMemory({ id: 'mem' });

        it('базовые поля spec', () => {
            expect(node.data.name).toBe('bufferWindowMemory');
            expect(node.data.type).toBe('BufferWindowMemory');
            expect(node.data.version).toBe(2);
            expect(node.data.category).toBe('Memory');
        });

        it('baseClasses точный массив', () => {
            expect(node.data.baseClasses).toEqual([
                'BufferWindowMemory',
                'BaseChatMemory',
                'BaseMemory',
            ]);
        });

        it('всё — params (k, sessionId, memoryKey)', () => {
            expect(node.data.inputAnchors).toEqual([]);
            const paramNames = node.data.inputParams?.map((p) => p.name) ?? [];
            expect(paramNames).toEqual(['k', 'sessionId', 'memoryKey']);
        });
    });

    describe('jsonFile', () => {
        const node = jsonFile({ id: 'json' });

        it('базовые поля spec', () => {
            expect(node.data.name).toBe('jsonFile');
            expect(node.data.label).toBe('Json File');
            expect(node.data.type).toBe('Document');
            expect(node.data.version).toBe(3);
            expect(node.data.category).toBe('Document Loaders');
        });

        it('baseClasses точный массив', () => {
            expect(node.data.baseClasses).toEqual(['Document']);
        });

        it('textSplitter — anchor, остальные — params', () => {
            const anchorNames = node.data.inputAnchors.map((a) => a.name);
            expect(anchorNames).toEqual(['textSplitter']);
            expect(node.data.inputAnchors[0]?.type).toBe('TextSplitter');

            const paramNames = node.data.inputParams?.map((p) => p.name) ?? [];
            expect(paramNames).toEqual([
                'jsonFile',
                'separateByObject',
                'pointersName',
                'metadata',
                'omitMetadataKeys',
            ]);
        });

        it('явные outputs', () => {
            expect(node.data.outputAnchors).toEqual([
                { label: 'Output', name: 'output', type: 'options' },
            ]);
        });
    });

    describe('s3File', () => {
        const node = s3File({
            id: 's3',
            inputs: { bucketName: 'b', keyName: 'k' },
        });

        it('базовые поля spec', () => {
            expect(node.data.name).toBe('S3');
            expect(node.data.label).toBe('S3');
            expect(node.data.type).toBe('Document');
            expect(node.data.version).toBe(5);
            expect(node.data.category).toBe('Document Loaders');
        });

        it('baseClasses точный массив', () => {
            expect(node.data.baseClasses).toEqual(['Document']);
        });

        it('textSplitter — anchor, остальные — params', () => {
            const anchorNames = node.data.inputAnchors.map((a) => a.name);
            expect(anchorNames).toEqual(['textSplitter']);
            expect(node.data.inputAnchors[0]?.type).toBe('TextSplitter');

            const paramNames = node.data.inputParams?.map((p) => p.name) ?? [];
            expect(paramNames).toEqual([
                'bucketName',
                'keyName',
                'region',
                'fileProcessingMethod',
                'metadata',
                'omitMetadataKeys',
            ]);
        });

        it('inputs пробрасываются + дефолты region/fileProcessingMethod', () => {
            expect(node.data.inputs.bucketName).toBe('b');
            expect(node.data.inputs.keyName).toBe('k');
            expect(node.data.inputs.region).toBe('us-east-1');
            expect(node.data.inputs.fileProcessingMethod).toBe('builtIn');
        });

        it('пользовательский region перекрывает дефолт', () => {
            const custom = s3File({
                id: 's3',
                inputs: { bucketName: 'b', keyName: 'k', region: 'eu-central-1' },
            });
            expect(custom.data.inputs.region).toBe('eu-central-1');
        });

        it('явные outputs', () => {
            expect(node.data.outputAnchors).toEqual([
                { label: 'Output', name: 'output', type: 'options' },
            ]);
        });
    });
});
