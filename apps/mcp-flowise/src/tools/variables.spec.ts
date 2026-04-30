import { setupFetchMock } from '../__test-helpers__/setup-fetch';
import {
    variablesCreateHandler,
    variablesDeleteHandler,
    variablesListHandler,
    variablesUpdateHandler,
} from './variables';

const SAMPLE_VAR = {
    id: 'v1',
    name: 'company',
    value: 'Аквафор',
    type: 'static' as const,
    createdDate: '2026-01-01T00:00:00Z',
    updatedDate: '2026-01-01T00:00:00Z',
};

describe('variables tools', () => {
    const helpers = setupFetchMock();

    it('list → count + variables[]', async () => {
        helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk([SAMPLE_VAR]));
        const result = await variablesListHandler({});
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.count).toBe(1);
            expect(result.data.variables[0]?.id).toBe('v1');
        }
    });

    it('create — POST с input', async () => {
        helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk(SAMPLE_VAR));
        await variablesCreateHandler({ name: 'company', value: 'Аквафор', type: 'static' });
        const [url, init] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toContain('/variables');
        expect(init.method).toBe('POST');
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(body.name).toBe('company');
        expect(body.value).toBe('Аквафор');
    });

    it('update — PUT без variableId в body', async () => {
        helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk(SAMPLE_VAR));
        await variablesUpdateHandler({ variableId: 'v1', value: 'NewValue' });
        const [url, init] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toContain('/variables/v1');
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(body.variableId).toBeUndefined();
        expect(body.value).toBe('NewValue');
    });

    it('delete → ok=true', async () => {
        helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk({}));
        const result = await variablesDeleteHandler({ variableId: 'v1' });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.ok).toBe(true);
    });

    it('500 → success=false', async () => {
        helpers.fetchMock.mockResolvedValueOnce(helpers.mockErr(500, { message: 'Server' }));
        const result = await variablesListHandler({});
        expect(result.success).toBe(false);
    });
});
