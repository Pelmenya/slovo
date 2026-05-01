// =============================================================================
// DI токены — Symbol per существующий паттерн (см. catalog-refresh.constants.ts).
// Изолированы от других модулей которые могут DI-нить свои Flowise/Redis/S3
// клиенты с другим конфигом.
// =============================================================================

export const FLOWISE_CLIENT_TOKEN = Symbol('CATALOG_FLOWISE_CLIENT');
export const REDIS_CLIENT_TOKEN = Symbol('CATALOG_REDIS_CLIENT');
export const CATALOG_STORAGE_SERVICE_TOKEN = Symbol('CATALOG_STORAGE_SERVICE');

// =============================================================================
// Document Store id для каталога Аквафор. Создан в Phase 0 через REST API
// (см. lab journal day 2 — `docs/experiments/vision-catalog/...`).
//
// TODO(multi-tenant): когда появятся пользователи / per-tenant каталоги —
// маппить через Prisma TenantConfig (user.tenantId → storeId). Сейчас single
// store hardcoded — допустимо для MVP. Тот же подход в catalog-refresh
// (через name lookup), здесь — direct id для search-hot-path.
// =============================================================================

export const CATALOG_AQUAPHOR_STORE_ID = 'aec6b741-8610-4f98-9f5c-bc829dc41a96';

// =============================================================================
// Top-K границы. Default=10 — баланс между coverage и latency. Max=50 — защита
// от unbounded query (Flowise embedding на query — O(1), но retrieval из
// pgvector linear по k; на 1000+ items LIMIT 50 ещё быстро, выше — деградация).
// =============================================================================

export const CATALOG_DEFAULT_TOP_K = 10;
export const CATALOG_MIN_TOP_K = 1;
export const CATALOG_MAX_TOP_K = 50;
export const CATALOG_MAX_QUERY_LENGTH = 500;

// =============================================================================
// Presigned URL cache — Redis с TTL чуть меньше самого signed URL TTL чтобы
// не отдать просроченный.
//
// CATALOG_PRESIGNED_URL_TTL_SEC — TTL самой подписи AWS (1ч).
// CATALOG_PRESIGNED_CACHE_TTL_SEC — TTL Redis-кэша (50м, на 10 мин меньше).
// Когда signed URL почти истёк, мы перегенерим новый при следующем search,
// клиенту не достанется dead URL.
// =============================================================================

export const CATALOG_PRESIGNED_URL_TTL_SEC = 3600;
export const CATALOG_PRESIGNED_CACHE_TTL_SEC = 3000;
export const CATALOG_PRESIGNED_CACHE_KEY_PREFIX = 'slovo:catalog:presigned:';
