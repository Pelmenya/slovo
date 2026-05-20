/**
 * Step 1 — Flowise credentials из env vars.
 *
 * Принцип: credentials НЕ в git (encrypted blobs). Создаются programmatically
 * из env vars при каждом bootstrap. Идемпотентны — если credential с таким
 * именем уже есть, skip (если FORCE_RECREATE=1, delete + recreate).
 *
 * Возвращает `nameToId: Record<string, string>` — нужно дальше для
 * `02-document-stores` и `03-chatflows` чтобы patch'ить `{{CREDENTIAL_REF:name}}`
 * placeholder'ы в exported JSON.
 */

import type { FlowiseClient } from '@slovo/flowise-client';
import type { TBootstrapEnv } from './lib/env-validator';
import { ensureResource, logSection, type TEnsureContext } from './lib/idempotent';

const SCOPE = '01-credentials';

// Имена credentials — single source of truth. Должны совпадать с тем, что
// в exports/chatflows/*.json placeholder'ах {{CREDENTIAL_REF:anthropic-prod}}.
// При renaming здесь — нужно делать prod:export повторно с актуальных chatflow'ов.
export const CREDENTIAL_NAMES = {
    anthropic: 'anthropic-prod',
    openai: 'openai-prod',
    postgres: 'postgres-slovo-prod',
    minio: 'minio-slovo-datasets',
} as const;

/**
 * Flowise credential schemas — какие поля credentialData ожидает каждый
 * credentialName. Эти схемы зашиты в Flowise components (см.
 * `flowise-components/credentials/<Name>.credential.ts` в исходнике).
 *
 * При апгрейде Flowise — сверять с актуальными definitions.
 */
type TAnthropicCredentialData = { anthropicApiKey: string };
type TOpenAICredentialData = { openAIApiKey: string };
type TPostgresCredentialData = { user: string; password: string };
type TS3CredentialData = {
    awsKey: string;
    awsSecret: string;
    awsRegion?: string;
    awsEndpoint?: string;
};

export type TCredentialBootstrapResult = {
    /** name → UUID для следующих шагов (document-stores, chatflows). */
    nameToId: Record<string, string>;
};

export async function bootstrapCredentials(
    flowise: FlowiseClient,
    env: TBootstrapEnv,
    forceRecreate: boolean,
): Promise<TCredentialBootstrapResult> {
    logSection(SCOPE, 'Creating Flowise credentials from env vars');
    const ctx: TEnsureContext = { flowise, forceRecreate, scope: SCOPE };
    const nameToId: Record<string, string> = {};

    nameToId[CREDENTIAL_NAMES.anthropic] = (
        await ensureCredential(ctx, CREDENTIAL_NAMES.anthropic, 'anthropicApi', {
            anthropicApiKey: env.anthropicApiKey,
        })
    ).id;

    nameToId[CREDENTIAL_NAMES.openai] = (
        await ensureCredential(ctx, CREDENTIAL_NAMES.openai, 'openAIApi', {
            openAIApiKey: env.openaiApiKey,
        })
    ).id;

    nameToId[CREDENTIAL_NAMES.postgres] = (
        await ensureCredential(ctx, CREDENTIAL_NAMES.postgres, 'PostgresApi', {
            user: env.postgresUser,
            password: env.postgresPassword,
        })
    ).id;

    nameToId[CREDENTIAL_NAMES.minio] = (
        await ensureCredential(ctx, CREDENTIAL_NAMES.minio, 'awsApi', {
            awsKey: env.s3AccessKey,
            awsSecret: env.s3SecretKey,
            // region/endpoint опц — Flowise S3 File Loader / S3 Object Loader
            // используют отдельный credential тип `s3` с дополнительными полями.
            // Для `awsApi` минимум — key+secret, остальное на vectorStore config.
        })
    ).id;

    return { nameToId };
}

// =============================================================================
// Internal — обёртка над Flowise REST credentials endpoint
// =============================================================================

type TCredentialListItem = { id: string; name: string; credentialName: string };
type TCredentialCreateResponse = { id: string };

async function ensureCredential(
    ctx: TEnsureContext,
    name: string,
    credentialName: string,
    credentialData:
        | TAnthropicCredentialData
        | TOpenAICredentialData
        | TPostgresCredentialData
        | TS3CredentialData,
): Promise<{ id: string }> {
    const result = await ensureResource<TCredentialCreateResponse>({
        ctx,
        resourceLabel: 'credential',
        name,
        list: async () => {
            const items = await ctx.flowise.request<TCredentialListItem[]>('/api/v1/credentials');
            return items.map((i) => ({ id: i.id, name: i.name }));
        },
        create: async () =>
            ctx.flowise.request<TCredentialCreateResponse>('/api/v1/credentials', {
                method: 'POST',
                body: {
                    name,
                    credentialName,
                    plainDataObj: credentialData,
                },
            }),
        deleteById: async (id) => {
            await ctx.flowise.request(`/api/v1/credentials/${id}`, { method: 'DELETE' });
        },
        extractIdFromCreate: (r) => r.id,
    });
    return { id: result.id };
}
