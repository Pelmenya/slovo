import { setupFetchMock } from '../__test-helpers__/setup-fetch';
import {
    chatflowCreateHandler,
    chatflowDeleteHandler,
    chatflowGetByApiKeyHandler,
    chatflowGetHandler,
    chatflowListHandler,
    chatflowUpdateHandler,
} from './chatflow';

const SAMPLE_CF = {
    id: 'cf-1',
    name: 'My Flow',
    flowData: '{"nodes":[],"edges":[]}',
    deployed: true,
    isPublic: false,
    type: 'CHATFLOW' as const,
    category: null,
    chatbotConfig: null,
    apiConfig: null,
    speechToText: null,
    followUpPrompts: null,
    apikeyid: 'k1',
    createdDate: '2026-01-01T00:00:00Z',
    updatedDate: '2026-01-02T00:00:00Z',
};

const SAMPLE_AGENT = { ...SAMPLE_CF, id: 'cf-2', type: 'AGENTFLOW' as const, name: 'Agent' };

describe('chatflow tools', () => {
    const helpers = setupFetchMock();

    describe('chatflow_list', () => {
        it('возвращает список без flowData', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk([SAMPLE_CF, SAMPLE_AGENT]));
            const result = await chatflowListHandler({});
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.count).toBe(2);
                expect(result.data.chatflows[0]?.id).toBe('cf-1');
                expect(result.data.chatflows[0]).not.toHaveProperty('flowData');
            }
        });

        it('фильтрует по type', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk([SAMPLE_CF, SAMPLE_AGENT]));
            const result = await chatflowListHandler({ type: 'AGENTFLOW' });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.count).toBe(1);
                expect(result.data.chatflows[0]?.type).toBe('AGENTFLOW');
            }
        });

        it('сетевая ошибка → success=false', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockErr(500, { message: 'Internal' }));
            const result = await chatflowListHandler({});
            expect(result.success).toBe(false);
        });
    });

    describe('chatflow_get', () => {
        it('по умолчанию без flowData', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk(SAMPLE_CF));
            const result = await chatflowGetHandler({ chatflowId: 'cf-1', includeFlowData: false });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.flowData).toBeUndefined();
                expect(result.data.id).toBe('cf-1');
            }
        });

        it('includeFlowData=true возвращает flowData', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk(SAMPLE_CF));
            const result = await chatflowGetHandler({ chatflowId: 'cf-1', includeFlowData: true });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.flowData).toBe(SAMPLE_CF.flowData);
            }
        });

        it('404 → success=false', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockErr(404, { message: 'Not found' }));
            const result = await chatflowGetHandler({ chatflowId: 'missing' });
            expect(result.success).toBe(false);
        });
    });

    describe('chatflow_get_by_apikey', () => {
        it('возвращает список chatflows доступных по apikey', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk([SAMPLE_CF]));
            const result = await chatflowGetByApiKeyHandler({ apikey: 'XX.XXXX' });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.count).toBe(1);
            }
        });
    });

    describe('chatflow_create', () => {
        it('POST с правильным body', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk(SAMPLE_CF));
            const result = await chatflowCreateHandler({
                name: 'New',
                flowData: '{"nodes":[]}',
                deployed: false,
            });
            expect(result.success).toBe(true);
            const [, init] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
            expect(init.method).toBe('POST');
            const body = JSON.parse(String(init.body)) as Record<string, unknown>;
            expect(body.name).toBe('New');
            expect(body.flowData).toBe('{"nodes":[]}');
        });

        it('400 → success=false', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockErr(400, { message: 'Invalid flowData' }));
            const result = await chatflowCreateHandler({ name: 'X', flowData: 'invalid' });
            expect(result.success).toBe(false);
        });
    });

    describe('chatflow_update', () => {
        it('PUT с body без chatflowId', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk(SAMPLE_CF));
            await chatflowUpdateHandler({ chatflowId: 'cf-1', name: 'Renamed', deployed: true });
            const [url, init] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
            expect(url).toContain('/chatflows/cf-1');
            expect(init.method).toBe('PUT');
            const body = JSON.parse(String(init.body)) as Record<string, unknown>;
            expect(body.chatflowId).toBeUndefined();
            expect(body.name).toBe('Renamed');
        });
    });

    describe('chatflow_delete', () => {
        it('DELETE возвращает ok', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk({}));
            const result = await chatflowDeleteHandler({ chatflowId: 'cf-1' });
            expect(result.success).toBe(true);
            if (result.success) expect(result.data.ok).toBe(true);
        });
    });
});
