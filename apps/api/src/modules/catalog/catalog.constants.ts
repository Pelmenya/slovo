// =============================================================================
// DI токены — Symbol per существующий паттерн (см. catalog-refresh.constants.ts).
// Изолированы от других модулей которые могут DI-нить свои Flowise/Redis/S3
// клиенты с другим конфигом.
// =============================================================================

export const FLOWISE_CLIENT_TOKEN = Symbol('CATALOG_FLOWISE_CLIENT');
export const REDIS_CLIENT_TOKEN = Symbol('CATALOG_REDIS_CLIENT');

// Document Store name каталога Аквафор — re-export из libs/common чтобы
// существующий импорт `from '../catalog.constants'` не ломался. Канонический
// источник — `@slovo/common` (используется и в apps/worker/catalog-refresh).
//
// Раньше API использовал hardcoded UUID `aec6b741-...` (Phase 0 store id),
// что создавало рассинхрон с worker'ом (тот резолвит через name): при reset
// Flowise dev-инстанса id меняется → API ломается тихо. Теперь оба идут
// через name lookup (TextSearchService.lookupStoreId, lazy + single-flight
// retry on failure).
export { CATALOG_AQUAPHOR_STORE_NAME } from '@slovo/common';

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

// =============================================================================
// PR8 — image search constants
// =============================================================================

// Имя Flowise chatflow для vision-describer — re-export из libs/common
// (единый source-of-truth с возможным batch image processing в worker
// в будущем). Phase 0 chatflow validated на 6 фото в lab journal day 1.
// chatflowId резолвится lazy + single-flight (паттерн из text.service:resolveStoreId).
export { VISION_CATALOG_DESCRIBER_CHATFLOW_NAME as VISION_CHATFLOW_NAME } from '@slovo/common';

// Mime whitelist для image upload — что Claude Vision принимает + чем
// феедер легитимно может прислать. avif/heic/svg / jpegxl исключены —
// edge format'ы которые Vision не всегда обрабатывает + svg attack vector.
//
// `as const` tuple вместо Set — даёт type narrowing в IsIn() и убирает
// runtime Array.from() конверсии в DTO.
export const VISION_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type TVisionAllowedMime = (typeof VISION_ALLOWED_MIME_TYPES)[number];

// Max декодированный размер картинки = 5MB. Anthropic Vision принимает до
// 100 images × 1568 tokens caps. С 5MB JPEG получаем достаточно деталей
// для product photo. DTO использует @MaxDecodedBytes(VISION_MAX_IMAGE_SIZE_BYTES)
// — точная decoded validation (vs string length которая раздувается на 33%
// и допускала бы 5MB декодированных padding).
export const VISION_MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

// Vision-search это **дорогая** операция — ~$0.005-0.007 за вызов
// (Claude Sonnet 4.6 Vision). Throttle 5/min/IP vs 30/min для text:
// (1) cost cap — 5 × 60 = 300 vision/час max от 1 IP = $1.5/час,
// (2) Vision response 2-4 sec — slow, чтобы не подвешивать pool API.
// Anonymous limit. Authenticated пользователи получат больше после auth.
export const VISION_SEARCH_THROTTLE_LIMIT = 5;
export const VISION_SEARCH_THROTTLE_TTL_MS = 60_000;
