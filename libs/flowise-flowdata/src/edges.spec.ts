import { buildEdge, makeSourceHandle, makeTargetHandle } from './edges';
import { chatAnthropic } from './factories/chat-models';
import { conversationalRetrievalQAChain } from './factories/chains';
import { openAIEmbeddings } from './factories/embeddings';
import { postgresVectorStore } from './factories/vectorstores';

describe('edges', () => {
    describe('makeSourceHandle', () => {
        it('строит handle с anchor name + concatenated baseClasses', () => {
            const node = chatAnthropic({ id: 'llm' });
            const handle = makeSourceHandle(node);
            expect(handle).toBe(
                'llm-output-chatAnthropic-ChatAnthropic | ChatAnthropicMessages | BaseChatModel | BaseLanguageModel | Runnable',
            );
        });

        it('кидает если у ноды нет output anchors', () => {
            const node = chatAnthropic({ id: 'llm' });
            node.data.outputAnchors = [];
            expect(() => makeSourceHandle(node)).toThrow(/no output anchor/);
        });
    });

    describe('makeTargetHandle', () => {
        it('строит handle с найденным input anchor', () => {
            const node = conversationalRetrievalQAChain({ id: 'chain' });
            const handle = makeTargetHandle(node, 'model');
            expect(handle).toBe('chain-input-model-BaseChatModel');
        });

        it('кидает если anchor не найден', () => {
            const node = conversationalRetrievalQAChain({ id: 'chain' });
            expect(() => makeTargetHandle(node, 'nonexistent')).toThrow(/no input anchor/);
        });
    });

    describe('buildEdge', () => {
        it('собирает edge из source/target nodes', () => {
            const llm = chatAnthropic({ id: 'llm' });
            const chain = conversationalRetrievalQAChain({ id: 'chain' });
            const edge = buildEdge(
                { source: 'llm', target: 'chain', targetAnchor: 'model' },
                { llm, chain },
            );
            expect(edge.source).toBe('llm');
            expect(edge.target).toBe('chain');
            expect(edge.sourceHandle).toContain('llm-output-chatAnthropic');
            expect(edge.targetHandle).toBe('chain-input-model-BaseChatModel');
            expect(edge.type).toBe('buttonedge');
        });

        it('кидает если source node не найдена', () => {
            const chain = conversationalRetrievalQAChain({ id: 'chain' });
            expect(() =>
                buildEdge(
                    { source: 'missing', target: 'chain', targetAnchor: 'model' },
                    { chain },
                ),
            ).toThrow(/source node "missing" not found/);
        });

        it('embeddings → postgres (Embeddings input)', () => {
            const emb = openAIEmbeddings({ id: 'emb' });
            const pg = postgresVectorStore({ id: 'pg', inputs: { host: 'h', database: 'd' } });
            const edge = buildEdge(
                { source: 'emb', target: 'pg', targetAnchor: 'embeddings' },
                { emb, pg },
            );
            expect(edge.targetHandle).toBe('pg-input-embeddings-Embeddings');
        });
    });
});
