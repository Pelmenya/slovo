import { buildChatflow, serializeFlowData } from './build-chatflow';
import { chatAnthropic } from './factories/chat-models';
import { conversationalRetrievalQAChain } from './factories/chains';
import { openAIEmbeddings } from './factories/embeddings';
import { postgresVectorStore } from './factories/vectorstores';
import { bufferMemory } from './factories/memory';

describe('buildChatflow', () => {
    it('пустой ввод → empty flowData', () => {
        const result = buildChatflow({ nodes: [] });
        expect(result.nodes).toEqual([]);
        expect(result.edges).toEqual([]);
    });

    it('кидает на дубликат node id', () => {
        expect(() =>
            buildChatflow({
                nodes: [chatAnthropic({ id: 'llm' }), chatAnthropic({ id: 'llm' })],
            }),
        ).toThrow(/Duplicate node id: llm/);
    });

    it('собирает RAG-цепочку (catalog-embed-search-style)', () => {
        const flow = buildChatflow({
            nodes: [
                openAIEmbeddings({ id: 'emb', inputs: { modelName: 'text-embedding-3-small', dimensions: 1536 } }),
                postgresVectorStore({
                    id: 'pg',
                    inputs: { host: 'slovo-postgres', database: 'slovo', tableName: 'catalog_chunks' },
                }),
                chatAnthropic({ id: 'llm', inputs: { modelName: 'claude-sonnet-4-6', temperature: 0 } }),
                bufferMemory({ id: 'mem' }),
                conversationalRetrievalQAChain({ id: 'chain', inputs: { returnSourceDocuments: true } }),
            ],
            edges: [
                { source: 'emb', target: 'pg', targetAnchor: 'embeddings' },
                { source: 'llm', target: 'chain', targetAnchor: 'model' },
                { source: 'pg', target: 'chain', targetAnchor: 'vectorStoreRetriever' },
                { source: 'mem', target: 'chain', targetAnchor: 'memory' },
            ],
        });
        expect(flow.nodes).toHaveLength(5);
        expect(flow.edges).toHaveLength(4);
        // serialization доводит flowData до строки которую chatflow_create примет
        const serialized = serializeFlowData(flow);
        expect(typeof serialized).toBe('string');
        const parsed = JSON.parse(serialized) as { nodes: unknown[]; edges: unknown[] };
        expect(parsed.nodes).toHaveLength(5);
        expect(parsed.edges).toHaveLength(4);
    });

    it('credential подставляется в inputs.FLOWISE_CREDENTIAL_ID', () => {
        const flow = buildChatflow({
            nodes: [
                chatAnthropic({ id: 'llm', credential: 'cred-anthropic-1' }),
            ],
        });
        const node = flow.nodes[0];
        expect(node?.data.inputs.FLOWISE_CREDENTIAL_ID).toBe('cred-anthropic-1');
    });

    it('inputs ноды пробрасываются корректно (form values)', () => {
        const flow = buildChatflow({
            nodes: [
                chatAnthropic({
                    id: 'llm',
                    inputs: { modelName: 'claude-sonnet-4-6', temperature: 0.7, streaming: true },
                }),
            ],
        });
        const node = flow.nodes[0];
        expect(node?.data.inputs.modelName).toBe('claude-sonnet-4-6');
        expect(node?.data.inputs.temperature).toBe(0.7);
        expect(node?.data.inputs.streaming).toBe(true);
    });
});
