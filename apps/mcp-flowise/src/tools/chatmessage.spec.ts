import { setupFetchMock } from '../__test-helpers__/setup-fetch';
import {
    chatmessageAbortHandler,
    chatmessageDeleteAllHandler,
    chatmessageListHandler,
} from './chatmessage';

const SAMPLE_MSG = {
    id: 'm1',
    role: 'userMessage' as const,
    chatflowid: 'cf-1',
    chatId: 'session-1',
    content: 'hello',
    chatType: 'INTERNAL' as const,
    sessionId: 'session-1',
    memoryType: 'Buffer Memory',
    sourceDocuments: '[]',
    fileUploads: '[]',
    usedTools: '[]',
    fileAnnotations: '[]',
    createdDate: '2026-01-01T00:00:00Z',
};

describe('chatmessage_list handler', () => {
    const helpers = setupFetchMock();

    it('возвращает Pick без огромных source/upload полей', async () => {
        helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk([SAMPLE_MSG]));
        const result = await chatmessageListHandler({ chatflowId: 'cf-1' });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.count).toBe(1);
            const m = result.data.messages[0];
            expect(m?.content).toBe('hello');
            expect(m).not.toHaveProperty('sourceDocuments');
            expect(m).not.toHaveProperty('fileUploads');
            expect(m).not.toHaveProperty('usedTools');
        }
    });

    it('фильтры идут в query', async () => {
        helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk([]));
        await chatmessageListHandler({
            chatflowId: 'cf-1',
            chatId: 'session-1',
            chatType: 'INTERNAL',
            limit: 50,
        });
        const [url] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toContain('chatId=session-1');
        expect(url).toContain('chatType=INTERNAL');
        expect(url).toContain('limit=50');
    });

    it('500 → success=false', async () => {
        helpers.fetchMock.mockResolvedValueOnce(helpers.mockErr(500, 'oops'));
        const result = await chatmessageListHandler({ chatflowId: 'cf-1' });
        expect(result.success).toBe(false);
    });

    describe('chatmessage_abort', () => {
        it('PUT на /chatmessage/abort/:cf/:chat → ok', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk({}));
            const result = await chatmessageAbortHandler({
                chatflowId: 'cf-1',
                chatId: 'session-1',
            });
            expect(result.success).toBe(true);
            const [url, init] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
            expect(url).toContain('/chatmessage/abort/cf-1/session-1');
            expect(init.method).toBe('PUT');
        });
    });

    describe('chatmessage_delete_all', () => {
        it('DELETE на /chatmessage/:cf без фильтров → весь chat снесён', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk({}));
            const result = await chatmessageDeleteAllHandler({ chatflowId: 'cf-1' });
            expect(result.success).toBe(true);
            const [url, init] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
            expect(url).toContain('/chatmessage/cf-1');
            expect(init.method).toBe('DELETE');
        });

        it('фильтры (chatId/chatType) идут в query', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk({}));
            await chatmessageDeleteAllHandler({
                chatflowId: 'cf-1',
                chatId: 'session-1',
                chatType: 'INTERNAL',
            });
            const [url] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
            expect(url).toContain('chatId=session-1');
            expect(url).toContain('chatType=INTERNAL');
        });
    });
});
