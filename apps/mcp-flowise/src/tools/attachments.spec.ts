import { setupFetchMock } from '../__test-helpers__/setup-fetch';
import { attachmentsCreateHandler } from './attachments';

describe('attachments_create handler', () => {
    const helpers = setupFetchMock();

    it('POST на /attachments/:chatflowId с chatId и files', async () => {
        helpers.fetchMock.mockResolvedValueOnce(
            helpers.mockOk({ uploads: [{ name: 'test.png', type: 'file', mime: 'image/png' }] }),
        );
        await attachmentsCreateHandler({
            chatflowId: 'cf-1',
            chatId: 'session-1',
            files: [
                {
                    name: 'test.png',
                    type: 'file',
                    data: 'data:image/png;base64,iVBORw0KGgo...',
                    mime: 'image/png',
                },
            ],
        });
        const [url, init] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toContain('/attachments/cf-1');
        expect(init.method).toBe('POST');
        const body = JSON.parse(String(init.body)) as { chatId: string; files: unknown[] };
        expect(body.chatId).toBe('session-1');
        expect(body.files).toHaveLength(1);
    });

    it('400 → fail', async () => {
        helpers.fetchMock.mockResolvedValueOnce(helpers.mockErr(400, { message: 'Invalid' }));
        const result = await attachmentsCreateHandler({
            chatflowId: 'cf-1',
            chatId: 's1',
            files: [{ name: 'x', type: 'file', data: 'data:', mime: 'image/png' }],
        });
        expect(result.success).toBe(false);
    });
});
