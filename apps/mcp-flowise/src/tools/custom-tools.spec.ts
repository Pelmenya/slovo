import { setupFetchMock } from '../__test-helpers__/setup-fetch';
import {
    customToolsCreateHandler,
    customToolsDeleteHandler,
    customToolsGetHandler,
    customToolsListHandler,
    customToolsUpdateHandler,
} from './custom-tools';

const SAMPLE_TOOL = {
    id: 't1',
    name: 'get_weather',
    description: 'Get weather by city',
    color: '#ff0',
    iconSrc: null,
    schema: '{"type":"object"}',
    func: 'return $city',
    createdDate: '2026-01-01T00:00:00Z',
    updatedDate: '2026-01-01T00:00:00Z',
};

describe('custom_tools tools', () => {
    const helpers = setupFetchMock();

    it('list — Pick id/name/description (без schema/func — могут быть большими)', async () => {
        helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk([SAMPLE_TOOL]));
        const result = await customToolsListHandler({});
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.count).toBe(1);
            const tool = result.data.tools[0];
            expect(tool?.id).toBe('t1');
            expect(tool?.name).toBe('get_weather');
            expect(tool).not.toHaveProperty('schema');
            expect(tool).not.toHaveProperty('func');
        }
    });

    it('get — полный объект с schema+func', async () => {
        helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk(SAMPLE_TOOL));
        const result = await customToolsGetHandler({ toolId: 't1' });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.schema).toBe('{"type":"object"}');
            expect(result.data.func).toBe('return $city');
        }
    });

    it('create — POST с описанием+schema+func', async () => {
        helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk(SAMPLE_TOOL));
        await customToolsCreateHandler({
            name: 'new_tool',
            description: 'desc',
            schema: '{}',
            func: 'return 1',
        });
        const [, init] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
        expect(init.method).toBe('POST');
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(body.name).toBe('new_tool');
    });

    it('update — PUT без toolId в body', async () => {
        helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk(SAMPLE_TOOL));
        await customToolsUpdateHandler({ toolId: 't1', description: 'updated' });
        const [url, init] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toContain('/tools/t1');
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(body.toolId).toBeUndefined();
        expect(body.description).toBe('updated');
    });

    it('delete → ok=true', async () => {
        helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk({}));
        const result = await customToolsDeleteHandler({ toolId: 't1' });
        expect(result.success).toBe(true);
    });

    it('404 → success=false', async () => {
        helpers.fetchMock.mockResolvedValueOnce(helpers.mockErr(404, { message: 'Not found' }));
        const result = await customToolsGetHandler({ toolId: 'missing' });
        expect(result.success).toBe(false);
    });
});
