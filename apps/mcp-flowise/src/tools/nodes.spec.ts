import { setupFetchMock } from '../__test-helpers__/setup-fetch';
import { nodesGetHandler, nodesListHandler } from './nodes';

const SAMPLE_NODE = {
    name: 'chatAnthropic',
    label: 'Anthropic Claude',
    version: 8,
    type: 'ChatAnthropic',
    category: 'Chat Models',
    description: 'Wrapper around Claude',
    baseClasses: ['ChatAnthropic'],
    inputs: [
        { label: 'Model', name: 'model', type: 'options', optional: false },
        { label: 'Temperature', name: 'temperature', type: 'number', optional: true },
    ],
};

describe('nodes tools', () => {
    const helpers = setupFetchMock();

    describe('nodes_list', () => {
        it('без category — все ноды', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk([SAMPLE_NODE]));
            const result = await nodesListHandler({});
            expect(result.success).toBe(true);
            const [url] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
            expect(url).toContain('/nodes');
            expect(url).not.toContain('/category/');
        });

        it('с category — фильтр на стороне Flowise', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk([SAMPLE_NODE]));
            const result = await nodesListHandler({ category: 'Chat Models' });
            expect(result.success).toBe(true);
            const [url] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
            expect(url).toContain('/category/Chat%20Models');
            if (result.success) {
                expect(result.data.count).toBe(1);
                expect(result.data.nodes[0]?.name).toBe('chatAnthropic');
            }
        });

        it('500 → success=false', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockErr(500, 'oops'));
            const result = await nodesListHandler({});
            expect(result.success).toBe(false);
        });
    });

    describe('nodes_get', () => {
        it('возвращает полный node spec', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk(SAMPLE_NODE));
            const result = await nodesGetHandler({ name: 'chatAnthropic' });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.inputs).toHaveLength(2);
                expect(result.data.version).toBe(8);
            }
        });

        it('404 → success=false', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockErr(404, { message: 'Node not found' }));
            const result = await nodesGetHandler({ name: 'unknown' });
            expect(result.success).toBe(false);
        });
    });
});
