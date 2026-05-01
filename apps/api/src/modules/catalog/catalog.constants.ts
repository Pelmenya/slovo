// =============================================================================
// DI токены — Symbol per существующий паттерн (см. catalog-refresh.constants.ts).
// Изолированы от других модулей которые могут DI-нить свои Flowise/Redis/S3
// клиенты с другим конфигом.
// =============================================================================

export const FLOWISE_CLIENT_TOKEN = Symbol('CATALOG_FLOWISE_CLIENT');
export const REDIS_CLIENT_TOKEN = Symbol('CATALOG_REDIS_CLIENT');

// =============================================================================
// Document Store name для каталога Аквафор — единый source-of-truth с
// catalog-refresh worker'ом (см. catalog-refresh.constants.ts:20).
//
// Раньше API использовал hardcoded UUID `aec6b741-...` (Phase 0 store id),
// что создавало рассинхрон с worker'ом (тот резолвит через name): при reset
// Flowise dev-инстанса id меняется → API ломается тихо. Теперь оба идут
// через name lookup (TextSearchService.lookupStoreId на старте, lazy +
// single-flight retry on failure).
//
// TODO(multi-tenant): когда появятся пользователи / per-tenant каталоги —
// маппить через Prisma TenantConfig (user.tenantId → storeName). Сейчас single
// store hardcoded — допустимо для MVP.
// =============================================================================

export const CATALOG_AQUAPHOR_STORE_NAME = 'catalog-aquaphor';

// =============================================================================
// Top-K границы. Default=10 — баланс между coverage и latency. Max=50 — защита
// от unbounded query (Flowise embedding на query — O(1), но retrieval из
// pgvector linear по k; на 1000+ items LIMIT 50 ещё быстро, выше — деградация).
// =============================================================================

export const CATALOG_DEFAULT_TOP_K = 10;
export const CATALOG_MIN_TOP_K = 1;
export const CATALOG_MAX_TOP_K = 50;

// CATALOG_MAX_QUERY_LENGTH = 500 chars — почему 500, а не token-based лимит
// OpenAI text-embedding-3-small (8191 tokens ≈ 30KB ASCII):
// (a) UX — natural language query вряд ли осмыслен >500 chars (одно-два
//     предложения на естественном языке).
// (b) embedding cost cap — без token counter здесь, char-based proxy: 500
//     chars ≈ 150-200 токенов, $0.00000012/query. Token burst через длинные
//     payload'ы исключён.
// (c) defense-in-depth от prompt injection попыток в metadata downstream:
//     Flowise vector search не рендерит query в LLM, но если позже добавим
//     hybrid Chain (ADR-008 future), 500-char hard cap страхует.
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
