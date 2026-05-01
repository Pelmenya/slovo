import type { TFlowiseDocumentStore } from '@slovo/flowise-client';

// =============================================================================
// catalog-refresh result shape для логирования и телеметрии.
// =============================================================================

export type TCatalogRefreshResult = {
    storeId: string;
    storeName: string;
    success: boolean;
    elapsedMs: number;
    skipped?: 'lock-held' | 'store-not-found';
    error?: string;
    flowiseResponse?: Record<string, unknown>;
};

export type TFindStoreResult =
    | { found: true; store: TFlowiseDocumentStore }
    | { found: false; error: string };
