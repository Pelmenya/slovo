import { setupFetchMock } from '../__test-helpers__/setup-fetch';
import { vectorUpsertHandler } from './vector';

describe('vector_upsert handler', () => {
    const helpers = setupFetchMock();

    it('POST на /vector/upsert/:chatflowId без chatflowId в body', async () => {
        helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk({ numAdded: 10 }));
        await vectorUpsertHandler({
            chatflowId: 'cf-1',
            overrideConfig: { temperature: 0.5 },
        });
        const [url, init] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toContain('/vector/upsert/cf-1');
        expect(init.method).toBe('POST');
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(body.chatflowId).toBeUndefined();
        expect(body.overrideConfig).toEqual({ temperature: 0.5 });
    });

    it('500 → success=false', async () => {
        helpers.fetchMock.mockResolvedValueOnce(helpers.mockErr(500, { message: 'Server' }));
        const result = await vectorUpsertHandler({ chatflowId: 'cf-1' });
        expect(result.success).toBe(false);
    });
});
