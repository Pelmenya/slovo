import { setupFetchMock } from '../__test-helpers__/setup-fetch';
import {
    assistantsCreateHandler,
    assistantsDeleteHandler,
    assistantsGetHandler,
    assistantsListHandler,
    assistantsUpdateHandler,
} from './assistants';

const SAMPLE_ASSISTANT = {
    id: 'a1',
    credential: 'cred-1',
    details: '{"instructions":"You are helpful"}',
    iconSrc: null,
    type: 'OPENAI' as const,
    createdDate: '2026-01-01T00:00:00Z',
    updatedDate: '2026-01-01T00:00:00Z',
};

const SAMPLE_AZURE = { ...SAMPLE_ASSISTANT, id: 'a2', type: 'AZURE' as const };

describe('assistants tools', () => {
    const helpers = setupFetchMock();

    it('list — Pick без details (большой JSON)', async () => {
        helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk([SAMPLE_ASSISTANT, SAMPLE_AZURE]));
        const result = await assistantsListHandler({});
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.count).toBe(2);
            const a = result.data.assistants[0];
            expect(a?.id).toBe('a1');
            expect(a?.type).toBe('OPENAI');
            expect(a).not.toHaveProperty('details');
            expect(a).not.toHaveProperty('credential');
        }
    });

    it('list — фильтр по type', async () => {
        helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk([SAMPLE_ASSISTANT, SAMPLE_AZURE]));
        const result = await assistantsListHandler({ type: 'AZURE' });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.count).toBe(1);
            expect(result.data.assistants[0]?.id).toBe('a2');
        }
    });

    it('get — полный объект с details', async () => {
        helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk(SAMPLE_ASSISTANT));
        const result = await assistantsGetHandler({ assistantId: 'a1' });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.details).toContain('helpful');
        }
    });

    it('create — POST', async () => {
        helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk(SAMPLE_ASSISTANT));
        await assistantsCreateHandler({ details: '{}', type: 'CUSTOM' });
        const [, init] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
        expect(init.method).toBe('POST');
    });

    it('update — PUT без assistantId в body', async () => {
        helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk(SAMPLE_ASSISTANT));
        await assistantsUpdateHandler({ assistantId: 'a1', details: '{"new":true}' });
        const [url, init] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toContain('/assistants/a1');
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(body.assistantId).toBeUndefined();
    });

    it('delete → ok', async () => {
        helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk({}));
        const result = await assistantsDeleteHandler({ assistantId: 'a1' });
        expect(result.success).toBe(true);
    });

    it('error → success=false', async () => {
        helpers.fetchMock.mockResolvedValueOnce(helpers.mockErr(500, { message: 'oops' }));
        const result = await assistantsListHandler({});
        expect(result.success).toBe(false);
    });
});
