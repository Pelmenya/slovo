import { z } from 'zod';
import { credentialsListHandler } from './credentials';
import { chatflowListHandler } from './chatflow';
import { docstoreListHandler } from './docstore';
import { nodesListHandler } from './nodes';
import { pingHandler } from './ping';
import type { TToolResult } from './t-tool';

// =============================================================================
// flowise_introspect — overview всего Flowise instance:
//   ping + счётчики chatflows / docstores / credentials + общий health.
// Quick orientation для Claude'а / нового разработчика — чтобы не дёргать
// 5 list-tools последовательно.
// =============================================================================

export const introspectSchema = z.object({});
export type TIntrospectInput = z.infer<typeof introspectSchema>;

export type TIntrospectData = {
    health: {
        ok: boolean;
        elapsedMs?: number;
    };
    counts: {
        chatflows: number;
        agentflows: number;
        documentStores: number;
        credentials: number;
        nodes: number;
    };
    failures: string[];
};

export async function introspectHandler(_input: TIntrospectInput): Promise<TToolResult<TIntrospectData>> {
    const failures: string[] = [];
    const ping = await pingHandler({});
    const cf = await chatflowListHandler({ type: 'CHATFLOW' });
    const af = await chatflowListHandler({ type: 'AGENTFLOW' });
    const ds = await docstoreListHandler({});
    const creds = await credentialsListHandler({});
    const nodes = await nodesListHandler({});

    if (!ping.success) failures.push(`ping: ${ping.error}`);
    if (!cf.success) failures.push(`chatflows: ${cf.error}`);
    if (!af.success) failures.push(`agentflows: ${af.error}`);
    if (!ds.success) failures.push(`docstores: ${ds.error}`);
    if (!creds.success) failures.push(`credentials: ${creds.error}`);
    if (!nodes.success) failures.push(`nodes: ${nodes.error}`);

    return {
        success: true,
        data: {
            health: {
                ok: ping.success,
                elapsedMs: ping.success ? ping.data.elapsedMs : undefined,
            },
            counts: {
                chatflows: cf.success ? cf.data.count : -1,
                agentflows: af.success ? af.data.count : -1,
                documentStores: ds.success ? ds.data.count : -1,
                credentials: creds.success ? creds.data.count : -1,
                nodes: nodes.success ? nodes.data.count : -1,
            },
            failures,
        },
    };
}

// =============================================================================
// flowise_smoke — быстрый прогон по основным list-endpoints.
// Возвращает per-endpoint статусы без аггрегации.
// =============================================================================

export const smokeSchema = z.object({});
export type TSmokeInput = z.infer<typeof smokeSchema>;

export type TSmokeStep = {
    name: string;
    success: boolean;
    error?: string;
    elapsedMs: number;
};

export type TSmokeData = {
    overallSuccess: boolean;
    steps: TSmokeStep[];
};

async function runStep(
    name: string,
    fn: () => Promise<TToolResult<unknown>>,
): Promise<TSmokeStep> {
    const start = Date.now();
    const result = await fn();
    const elapsedMs = Date.now() - start;
    if (result.success) {
        return { name, success: true, elapsedMs };
    }
    return { name, success: false, error: result.error, elapsedMs };
}

export async function smokeHandler(_input: TSmokeInput): Promise<TToolResult<TSmokeData>> {
    const steps: TSmokeStep[] = [
        await runStep('ping', () => pingHandler({})),
        await runStep('chatflows', () => chatflowListHandler({})),
        await runStep('docstores', () => docstoreListHandler({})),
        await runStep('credentials', () => credentialsListHandler({})),
        await runStep('nodes', () => nodesListHandler({})),
    ];
    const overallSuccess = steps.every((s) => s.success);
    return { success: true, data: { overallSuccess, steps } };
}

// =============================================================================
// flowise_docstore_search_by_name — find by name вместо по id.
// =============================================================================

export const docstoreSearchByNameSchema = z.object({
    name: z.string().min(1).describe('Полное или частичное совпадение по имени Document Store'),
    exactMatch: z.boolean().optional().describe('По умолчанию false — substring search'),
});
export type TDocstoreSearchByNameInput = z.infer<typeof docstoreSearchByNameSchema>;

export type TDocstoreSearchByNameData = {
    count: number;
    matches: Array<{ id: string; name: string; status: string; totalChunks: number }>;
};

export async function docstoreSearchByNameHandler(
    input: TDocstoreSearchByNameInput,
): Promise<TToolResult<TDocstoreSearchByNameData>> {
    const list = await docstoreListHandler({});
    if (!list.success) {
        return list;
    }
    const needle = input.name.toLowerCase();
    const matches = list.data.stores.filter((s) =>
        input.exactMatch
            ? s.name.toLowerCase() === needle
            : s.name.toLowerCase().includes(needle),
    );
    return {
        success: true,
        data: {
            count: matches.length,
            matches: matches.map((s) => ({
                id: s.id,
                name: s.name,
                status: s.status,
                totalChunks: s.totalChunks,
            })),
        },
    };
}
