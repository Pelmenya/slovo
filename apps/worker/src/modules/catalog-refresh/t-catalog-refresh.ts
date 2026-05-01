import type { TFlowiseDocumentStore } from '@slovo/flowise-client';

// =============================================================================
// catalog-refresh result shape — discriminated union на kind.
// TypeScript narrow'ит ветки автоматически, нельзя забыть проверить флаг.
// =============================================================================

export type TCatalogRefreshSuccess = {
    kind: 'success';
    storeId: string;
    storeName: string;
    elapsedMs: number;
    // Slovo-orchestrate (PR6.5): сколько items в payload, сколько successfully
    // upsert'нуто, сколько failed (per-item failure не валит весь refresh).
    itemsAttempted: number;
    itemsUpserted: number;
    itemsFailed: number;
    // Loaders в store, удалённые на этапе wipe (старые S3 / прежние PlainText).
    loadersWiped: number;
};

export type TCatalogRefreshSkipped = {
    kind: 'skipped';
    reason: 'lock-held' | 'store-not-found' | 'payload-not-found';
    storeName: string;
    elapsedMs: number;
    error?: string;
};

export type TCatalogRefreshFailure = {
    kind: 'failure';
    storeId: string;
    storeName: string;
    elapsedMs: number;
    error: string;
    // Etap на котором упало — для ловушек observability.
    stage:
        | 'fetch-config'
        | 'wipe-loaders'
        | 'wipe-vectors'
        | 'download-payload'
        | 'parse-payload'
        | 'upsert';
};

export type TCatalogRefreshResult =
    | TCatalogRefreshSuccess
    | TCatalogRefreshSkipped
    | TCatalogRefreshFailure;

export type TFindStoreResult =
    | { found: true; store: TFlowiseDocumentStore }
    | { found: false; error: string };
