import type { TFlowiseDocumentStore } from '@slovo/flowise-client';

// =============================================================================
// catalog-refresh result shape — discriminated union на kind.
// TypeScript narrow'ит ветки автоматически, нельзя забыть проверить флаг.
//
// PR9.5 RecordManager update: counters перевелись с
// «attempted/upserted/failed/loadersWiped» на «упсертнули реально / скипнули
// через RecordManager / удалили через REMOVED-sweep».
// =============================================================================

export type TCatalogRefreshSuccess = {
    kind: 'success';
    storeId: string;
    storeName: string;
    elapsedMs: number;
    // Сколько items в payload пришло
    itemsTotal: number;
    // Items которые Flowise обработал (NEW + CHANGED) — embedding cost
    // действительно потрачен. Каждый = ~$0.0000004 на text-embedding-3-small.
    itemsUpserted: number;
    // Items skipped через RecordManager hash check — content unchanged,
    // embedding НЕ вычислялся, $0 cost. Главный эффект PR9.5.
    itemsSkipped: number;
    // Items упавшие на Flowise upsert — не критично для refresh, но
    // следить через alert (slovo-orchestrate retry в next cron).
    itemsFailed: number;
    // Items удалённые из store потому что disappeared из payload.
    // REMOVED-sweep после upsert цикла.
    itemsRemoved: number;
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
    // Stage на котором упало — для ловушек observability.
    stage:
        | 'fetch-config'
        | 'load-loader-mapping'
        | 'download-payload'
        | 'parse-payload'
        | 'upsert'
        | 'remove-sweep';
};

export type TCatalogRefreshResult =
    | TCatalogRefreshSuccess
    | TCatalogRefreshSkipped
    | TCatalogRefreshFailure;

export type TFindStoreResult =
    | { found: true; store: TFlowiseDocumentStore }
    | { found: false; error: string };
