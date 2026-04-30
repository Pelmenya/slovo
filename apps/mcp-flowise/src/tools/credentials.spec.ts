import { setupFetchMock } from '../__test-helpers__/setup-fetch';
import {
    credentialsCreateHandler,
    credentialsDeleteHandler,
    credentialsGetHandler,
    credentialsListHandler,
    credentialsUpdateHandler,
} from './credentials';

const SAMPLE_LIST = [
    { id: 'a', name: 'OpenAI', credentialName: 'openAIApi' },
    { id: 'b', name: 'minio-slovo', credentialName: 'awsApi' },
    { id: 'c', name: 'postgres', credentialName: 'PostgresApi' },
];

const SAMPLE_DETAIL = {
    id: 'a',
    name: 'OpenAI',
    credentialName: 'openAIApi',
    plainDataObj: { openAIApiKey: '<encrypted>' },
};

describe('credentials tools', () => {
    const helpers = setupFetchMock();

    describe('credentials_list', () => {
        it('возвращает все credentials без фильтра', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk(SAMPLE_LIST));
            const result = await credentialsListHandler({});
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.count).toBe(3);
                expect(result.data.credentials.map((c) => c.id)).toEqual(['a', 'b', 'c']);
            }
        });

        it('фильтрует по credentialName', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk(SAMPLE_LIST));
            const result = await credentialsListHandler({ credentialName: 'awsApi' });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.count).toBe(1);
                expect(result.data.credentials[0]?.id).toBe('b');
            }
        });

        it('Unauthorized из Flowise → success=false', async () => {
            helpers.fetchMock.mockResolvedValueOnce(
                helpers.mockErr(401, { message: 'Unauthorized Access' }),
            );
            const result = await credentialsListHandler({});
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error).toContain('Unauthorized');
                expect(result.error).toContain('401');
            }
        });
    });

    describe('credentials_get', () => {
        it('возвращает детали по id', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk(SAMPLE_DETAIL));
            const result = await credentialsGetHandler({ credentialId: 'a' });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.id).toBe('a');
                expect(result.data.plainDataObj).toBeDefined();
            }
        });

        it('404 → success=false', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockErr(404, { message: 'Not found' }));
            const result = await credentialsGetHandler({ credentialId: 'missing' });
            expect(result.success).toBe(false);
        });
    });

    describe('credentials_create', () => {
        it('POST с plainDataObj', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk(SAMPLE_DETAIL));
            await credentialsCreateHandler({
                name: 'NewKey',
                credentialName: 'awsApi',
                plainDataObj: { accessKeyId: 'AKIA', secretAccessKey: 'secret' },
            });
            const [, init] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
            expect(init.method).toBe('POST');
            const body = JSON.parse(String(init.body)) as Record<string, unknown>;
            expect(body.name).toBe('NewKey');
            expect(body.credentialName).toBe('awsApi');
        });
    });

    describe('credentials_update', () => {
        it('PUT без credentialId в body', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk(SAMPLE_DETAIL));
            await credentialsUpdateHandler({ credentialId: 'a', name: 'Renamed' });
            const [url, init] = helpers.fetchMock.mock.calls[0] as [string, RequestInit];
            expect(url).toContain('/credentials/a');
            const body = JSON.parse(String(init.body)) as Record<string, unknown>;
            expect(body.credentialId).toBeUndefined();
            expect(body.name).toBe('Renamed');
        });
    });

    describe('credentials_delete', () => {
        it('DELETE → ok=true', async () => {
            helpers.fetchMock.mockResolvedValueOnce(helpers.mockOk({}));
            const result = await credentialsDeleteHandler({ credentialId: 'a' });
            expect(result.success).toBe(true);
            if (result.success) expect(result.data.ok).toBe(true);
        });
    });
});
