import { setupFetchMock } from '../__test-helpers__/setup-fetch';
import { predictionRunHandler } from './prediction';

describe('prediction_run handler', () => {
    const helpers = setupFetchMock();

    it('текстовый запрос — POST с question', async () => {
        helpers.fetchMock.mockResolvedValueOnce(
            helpers.mockOk({ text: 'pong', chatId: 'c1', sessionId: 's1' }),
        );
        const result = await predictionRunHandler({
            chatflowId: 'cf-1',
            question: 'hello',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.text).toBe('pong');
            expect(typeof result.data.elapsedMs).toBe('number');
        }
        const [url, init] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toContain('/prediction/cf-1');
        expect(init.method).toBe('POST');
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(body.question).toBe('hello');
        expect(body.chatflowId).toBeUndefined();
        expect(body.streaming).toBe(false);
    });

    it('image upload — base64 в uploads, корректный body', async () => {
        helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk({ text: 'description' }));
        await predictionRunHandler({
            chatflowId: 'vision-cf',
            question: 'describe',
            uploads: [
                {
                    data: 'data:image/png;base64,iVBORw0KGgo...',
                    type: 'file',
                    name: 'c125.png',
                    mime: 'image/png',
                },
            ],
        });
        const [, init] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
        const body = JSON.parse(String(init.body)) as { uploads: Array<{ name: string }> };
        expect(body.uploads).toHaveLength(1);
        expect(body.uploads[0]?.name).toBe('c125.png');
    });

    it('AgentFlow V2 form input', async () => {
        helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk({ json: { result: 'ok' } }));
        await predictionRunHandler({
            chatflowId: 'agent-cf',
            form: { topic: 'water', depth: 'deep' },
        });
        const [, init] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
        const body = JSON.parse(String(init.body)) as { form: Record<string, unknown> };
        expect(body.form).toEqual({ topic: 'water', depth: 'deep' });
    });

    it('history передаётся для multi-turn', async () => {
        helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk({ text: 'continued' }));
        await predictionRunHandler({
            chatflowId: 'cf-1',
            question: 'follow up',
            history: [
                { role: 'userMessage', content: 'first' },
                { role: 'apiMessage', content: 'first reply' },
            ],
        });
        const [, init] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
        const body = JSON.parse(String(init.body)) as {
            history: Array<{ role: string; content: string }>;
        };
        expect(body.history).toHaveLength(2);
    });

    it('overrideConfig прокидывается', async () => {
        helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk({ text: 'ok' }));
        await predictionRunHandler({
            chatflowId: 'cf-1',
            question: 'q',
            overrideConfig: { sessionId: 'abc', returnSourceDocuments: true },
        });
        const [, init] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
        const body = JSON.parse(String(init.body)) as { overrideConfig: Record<string, unknown> };
        expect(body.overrideConfig).toEqual({ sessionId: 'abc', returnSourceDocuments: true });
    });

    it('429 после исчерпания retry → FlowiseError', async () => {
        process.env.FLOWISE_MAX_RETRIES = '0';
        // resetConfig в beforeEach сбросит cached config
        helpers.fetchMock.mockResolvedValueOnce(
            helpers.mockErr(429, '', { 'retry-after': '0' }),
        );
        const result = await predictionRunHandler({ chatflowId: 'cf-1', question: 'q' });
        // Note: при FLOWISE_MAX_RETRIES=0 единственный 429 без ретрая — кидаем FlowiseError(429)
        expect(result.success).toBe(false);
    });

    it('500 → success=false', async () => {
        helpers.fetchMock.mockResolvedValueOnce(helpers.mockErr(500, { message: 'Server error' }));
        const result = await predictionRunHandler({ chatflowId: 'cf-1', question: 'q' });
        expect(result.success).toBe(false);
    });
});
