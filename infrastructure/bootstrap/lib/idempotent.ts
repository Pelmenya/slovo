/**
 * Idempotent ensure-helpers для bootstrap. Каждый ресурс:
 * 1. List existing → find by name
 * 2. Если есть и FORCE_RECREATE=0 → skip, return existing id
 * 3. Если есть и FORCE_RECREATE=1 → delete + create
 * 4. Если нет → create
 *
 * Печатает в stdout с префиксом [<scope>] для grep-friendly логов.
 */

import type { FlowiseClient } from '@slovo/flowise-client';

export type TEnsureContext = {
    flowise: FlowiseClient;
    forceRecreate: boolean;
    scope: string;
};

export type TEnsureResult = {
    id: string;
    name: string;
    action: 'created' | 'reused' | 'recreated';
};

export type TListedResource = {
    id: string;
    name: string;
};

export type TEnsureParams<TCreateResponse> = {
    ctx: TEnsureContext;
    resourceLabel: string;
    name: string;
    list: () => Promise<TListedResource[]>;
    create: () => Promise<TCreateResponse>;
    deleteById: (id: string) => Promise<void>;
    extractIdFromCreate: (response: TCreateResponse) => string;
};

export async function ensureResource<TCreateResponse>(
    params: TEnsureParams<TCreateResponse>,
): Promise<TEnsureResult> {
    const { ctx, resourceLabel, name, list, create, deleteById, extractIdFromCreate } = params;

    const existing = (await list()).find((r) => r.name === name);

    if (existing && !ctx.forceRecreate) {
        log(
            ctx,
            `${resourceLabel} "${name}": already exists (id=${existing.id.slice(0, 8)}…), skipped`,
        );
        return { id: existing.id, name, action: 'reused' };
    }

    if (existing && ctx.forceRecreate) {
        log(
            ctx,
            `${resourceLabel} "${name}": FORCE_RECREATE — deleting old (id=${existing.id.slice(0, 8)}…)`,
        );
        await deleteById(existing.id);
    }

    const response = await create();
    const id = extractIdFromCreate(response);
    log(
        ctx,
        `${resourceLabel} "${name}": ${existing ? 'recreated' : 'created'} (id=${id.slice(0, 8)}…)`,
    );
    return { id, name, action: existing ? 'recreated' : 'created' };
}

export function log(ctx: TEnsureContext, message: string): void {
    process.stdout.write(`[${ctx.scope}] ${message}\n`);
}

export function logSection(scope: string, message: string): void {
    process.stdout.write(`\n━━━ [${scope}] ${message} ━━━\n`);
}
