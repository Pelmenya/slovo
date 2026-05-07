// Constants для water-analysis модуля.
//
// Раньше тут был hardcoded UUID `96b809ee-...` — повторение ошибки которую
// уже допускали в catalog (см. `apps/api/src/modules/catalog/catalog.constants.ts:14`):
// при reset Flowise dev-инстанса id меняется → API ломается тихо. Теперь
// идём через name lookup (SimilarSearchService.lookupStoreId, lazy +
// single-flight retry on failure) — единый паттерн с catalog.
//
// Канонический source-of-truth имени — `@slovo/common` (общий между api и
// будущими consumer'ами: equipment-matcher / prostor-app / CRM-aqua).

export { WATER_ANALYSIS_AQUAPHOR_STORE_NAME } from '@slovo/common';

export const FLOWISE_CLIENT_TOKEN = Symbol('WATER_ANALYSIS_FLOWISE_CLIENT');

// =============================================================================
// Top-K границы. Default=10 — баланс coverage vs latency. Max=50 — защита от
// unbounded query (cosine distance в pgvector linear по k; для 15 504 chunks
// LIMIT 50 быстро, выше 50 retrieval начинает тормозить заметно).
// =============================================================================

export const SIMILAR_DEFAULT_TOP_K = 10;
export const SIMILAR_MIN_TOP_K = 1;
export const SIMILAR_MAX_TOP_K = 50;

// =============================================================================
// Throttle — защита от bottleneck Flowise vectorstoreQuery (~600ms/query).
// Cost атаки малый ($0.00002/query на text-embedding-3-large), но 100 concurrent
// от одного IP отъедят пул и сломают /catalog/search через тот же Flowise instance.
//
// 60/min/IP — мягче чем catalog (10/min/IP, оправдано $0.005/Vision-call), но
// strict достаточно: легитимный пользователь делает <5 поисков/мин при подборе
// оборудования. Для batch-API (CRM-aqua dealer-side) добавим отдельный
// authenticated endpoint без throttle.
// =============================================================================

export const SIMILAR_THROTTLE_LIMIT = 60;
export const SIMILAR_THROTTLE_TTL_MS = 60_000;
