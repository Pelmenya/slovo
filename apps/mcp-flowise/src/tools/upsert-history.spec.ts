import { setupFetchMock } from '../__test-helpers__/setup-fetch';
import { upsertHistoryListHandler } from './upsert-history';

const SAMPLE_HISTORY = {
    id: 'h1',
    chatflowid: 'cf-1',
    result: 'success',
    flowData: '{}',
    date: '2026-01-01T00:00:00Z',
};

describe('upsert_history_list handler', () => {
    const helpers = setupFetchMock();

    it('возвращает count + history[]', async () => {
        helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk([SAMPLE_HISTORY]));
        const result = await upsertHistoryListHandler({ chatflowId: 'cf-1' });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.count).toBe(1);
            expect(result.data.history[0]?.id).toBe('h1');
        }
    });

    it('limit + sortOrder в query', async () => {
        helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk([]));
        await upsertHistoryListHandler({ chatflowId: 'cf-1', sortOrder: 'ASC', limit: 10 });
        const [url] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toContain('sortOrder=ASC');
        expect(url).toContain('limit=10');
    });

    it('500 → success=false', async () => {
        helpers.fetchMock.mockResolvedValueOnce(helpers.mockErr(500, 'oops'));
        const result = await upsertHistoryListHandler({ chatflowId: 'cf-1' });
        expect(result.success).toBe(false);
    });
});
