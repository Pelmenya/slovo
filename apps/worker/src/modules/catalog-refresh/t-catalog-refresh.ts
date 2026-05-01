import type { TFlowiseDocumentStore, TFlowiseRefreshResponse } from '@slovo/flowise-client';

// =============================================================================
// catalog-refresh result shape — discriminated union на kind.
// TypeScript narrow'ит ветки автоматически, нельзя забыть проверить флаг.
// =============================================================================

export type TCatalogRefreshSuccess = {
    kind: 'success';
    storeId: string;
    storeName: string;
    elapsedMs: number;
    flowiseResponse: TFlowiseRefreshResponse;
};

export type TCatalogRefreshSkipped = {
    kind: 'skipped';
    reason: 'lock-held' | 'store-not-found';
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
};

export type TCatalogRefreshResult =
    | TCatalogRefreshSuccess
    | TCatalogRefreshSkipped
    | TCatalogRefreshFailure;

export type TFindStoreResult =
    | { found: true; store: TFlowiseDocumentStore }
    | { found: false; error: string };
