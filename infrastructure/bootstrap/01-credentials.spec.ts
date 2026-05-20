import type { FlowiseClient } from '@slovo/flowise-client';
import { bootstrapCredentials, CREDENTIAL_NAMES } from './01-credentials';
import type { TBootstrapEnv } from './lib/env-validator';

const TEST_ENV: TBootstrapEnv = {
    flowiseApiUrl: 'http://localhost:3130',
    flowiseApiKey: 'token',
    anthropicApiKey: 'sk-ant-test',
    openaiApiKey: 'sk-openai-test',
    postgresHost: 'localhost',
    postgresPort: 5432,
    postgresDb: 'slovo',
    postgresUser: 'slovo',
    postgresPassword: 'pass',
    s3Endpoint: 'http://minio:9000',
    s3AccessKey: 'minio',
    s3SecretKey: 'minio-pass',
    s3CatalogBucket: 'slovo-datasets',
    euProxyUrl: null,
    euProxyAuth: null,
    forceRecreate: false,
    deploymentRegion: 'dev',
};

type TFlowiseRequestMock = jest.MockedFunction<FlowiseClient['request']>;

/**
 * Helper — без type-narrowing на arguments tuple (TRequestOptions имеет
 * сложный generic, проще обращаться через runtime introspection).
 */
function getPostCalls(
    request: TFlowiseRequestMock,
): Array<{ path: string; body: Record<string, unknown> }> {
    return request.mock.calls
        .filter((call) => {
            const opts = call[1] as { method?: string } | undefined;
            return opts?.method === 'POST';
        })
        .map((call) => {
            const opts = call[1] as { body?: Record<string, unknown> } | undefined;
            return { path: call[0], body: opts?.body ?? {} };
        });
}

function getDeleteCalls(
    request: TFlowiseRequestMock,
): Array<{ path: string }> {
    return request.mock.calls
        .filter((call) => {
            const opts = call[1] as { method?: string } | undefined;
            return opts?.method === 'DELETE';
        })
        .map((call) => ({ path: call[0] }));
}

function buildMockFlowise(existingCredentials: Array<{ id: string; name: string; credentialName: string }>): {
    flowise: FlowiseClient;
    request: TFlowiseRequestMock;
} {
    const request: TFlowiseRequestMock = jest.fn().mockImplementation(
        async (path: string, options?: { method?: string; body?: unknown }) => {
            // GET /api/v1/credentials → list
            if (path === '/api/v1/credentials' && (!options || options.method === 'GET' || !options.method)) {
                return existingCredentials;
            }
            // POST /api/v1/credentials → create
            if (path === '/api/v1/credentials' && options?.method === 'POST') {
                const body = options.body as { name: string; credentialName: string };
                const newId = `new-${body.name}-uuid`;
                existingCredentials.push({
                    id: newId,
                    name: body.name,
                    credentialName: body.credentialName,
                });
                return { id: newId };
            }
            // DELETE /api/v1/credentials/<id>
            if (path.startsWith('/api/v1/credentials/') && options?.method === 'DELETE') {
                const id = path.split('/').pop();
                const idx = existingCredentials.findIndex((c) => c.id === id);
                if (idx >= 0) existingCredentials.splice(idx, 1);
                return undefined;
            }
            throw new Error(`Unexpected request: ${options?.method ?? 'GET'} ${path}`);
        },
    );
    return { flowise: { request } as unknown as FlowiseClient, request };
}

describe('bootstrapCredentials', () => {
    it('creates все 4 credentials в чистом Flowise', async () => {
        const { flowise, request } = buildMockFlowise([]);

        const result = await bootstrapCredentials(flowise, TEST_ENV, false);

        expect(Object.keys(result.nameToId)).toHaveLength(4);
        expect(result.nameToId[CREDENTIAL_NAMES.anthropic]).toMatch(/^new-anthropic-prod-uuid/);
        expect(result.nameToId[CREDENTIAL_NAMES.openai]).toMatch(/^new-openai-prod-uuid/);
        expect(result.nameToId[CREDENTIAL_NAMES.postgres]).toMatch(
            /^new-postgres-slovo-prod-uuid/,
        );
        expect(result.nameToId[CREDENTIAL_NAMES.minio]).toMatch(
            /^new-minio-slovo-datasets-uuid/,
        );

        // 4 list calls + 4 create calls
        const createCalls = getPostCalls(request);
        expect(createCalls).toHaveLength(4);
    });

    it('reuses existing credentials by name (idempotent)', async () => {
        const existing = [
            { id: 'existing-anthropic', name: 'anthropic-prod', credentialName: 'anthropicApi' },
            { id: 'existing-openai', name: 'openai-prod', credentialName: 'openAIApi' },
            { id: 'existing-postgres', name: 'postgres-slovo-prod', credentialName: 'PostgresApi' },
            { id: 'existing-minio', name: 'minio-slovo-datasets', credentialName: 'awsApi' },
        ];
        const { flowise, request } = buildMockFlowise(existing);

        const result = await bootstrapCredentials(flowise, TEST_ENV, false);

        expect(result.nameToId[CREDENTIAL_NAMES.anthropic]).toBe('existing-anthropic');
        expect(result.nameToId[CREDENTIAL_NAMES.openai]).toBe('existing-openai');
        expect(result.nameToId[CREDENTIAL_NAMES.postgres]).toBe('existing-postgres');
        expect(result.nameToId[CREDENTIAL_NAMES.minio]).toBe('existing-minio');

        // НЕТ create calls когда все существуют
        expect(getPostCalls(request)).toHaveLength(0);
    });

    it('recreates credentials when forceRecreate=true', async () => {
        const existing = [
            { id: 'old-anthropic', name: 'anthropic-prod', credentialName: 'anthropicApi' },
        ];
        const { flowise, request } = buildMockFlowise(existing);

        const result = await bootstrapCredentials(flowise, TEST_ENV, true);

        // anthropic пересоздан → новый id
        expect(result.nameToId[CREDENTIAL_NAMES.anthropic]).not.toBe('old-anthropic');

        // должен быть как DELETE так и POST для anthropic
        const deleteCalls = getDeleteCalls(request).filter((c) =>
            c.path.includes('old-anthropic'),
        );
        expect(deleteCalls).toHaveLength(1);
    });

    it('передаёт корректные plainDataObj fields в POST body', async () => {
        const { flowise, request } = buildMockFlowise([]);

        await bootstrapCredentials(flowise, TEST_ENV, false);

        const postCalls = getPostCalls(request);

        const anthropicCall = postCalls.find((c) => c.body.name === CREDENTIAL_NAMES.anthropic);
        expect(anthropicCall?.body).toMatchObject({
            name: 'anthropic-prod',
            credentialName: 'anthropicApi',
            plainDataObj: { anthropicApiKey: 'sk-ant-test' },
        });

        const postgresCall = postCalls.find((c) => c.body.name === CREDENTIAL_NAMES.postgres);
        expect(postgresCall?.body).toMatchObject({
            credentialName: 'PostgresApi',
            plainDataObj: { user: 'slovo', password: 'pass' },
        });
    });

    it('CREDENTIAL_NAMES constants — single source of truth (frozen)', () => {
        expect(CREDENTIAL_NAMES.anthropic).toBe('anthropic-prod');
        expect(CREDENTIAL_NAMES.openai).toBe('openai-prod');
        expect(CREDENTIAL_NAMES.postgres).toBe('postgres-slovo-prod');
        expect(CREDENTIAL_NAMES.minio).toBe('minio-slovo-datasets');
    });
});
