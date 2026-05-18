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

// =============================================================================
// Phase 1.5 Slice 1 — dedupe by externalId с over-fetch safety.
//
// Catalog feeder режет rich Vision-augmented descriptions на N чанков/товар,
// поэтому Flowise queryVectorStore может вернуть N чанков ОДНОГО товара.
// TextSearchService.search() делает `DISTINCT ON metadata.externalId` после
// получения результата от Flowise + slice к запрошенному `topK`.
//
// `topK=5` semantically = «5 unique товаров», не «5 chunks». Without over-fetch
// 5 chunks одного товара → 1 unique result после dedupe (regression). Поэтому
// запрашиваем в Flowise `effectiveTopK * MULTIPLIER` chunks, dedupe'им, slice'им.
//
// MULTIPLIER=5 — empiric: audit catalog Aquaphor через Document Store 2026-05-18
// показал 682 chunks / 155 products = **avg 4.4 chunks/product** (Vision-
// augmented rich descriptions режутся щедро). Worst case 5 RO products = 22
// chunks нужно для 5 unique. С MULTIPLIER=3 получали 15 raw → 4 unique (smoke
// curl `topK=5 → count=4` подтверждал degrade). MULTIPLIER=5 даёт 25 raw →
// 5+ unique уверенно.
//
// Latency cost: MULTIPLIER=3 на topK=5 давал 506ms median. MULTIPLIER=5
// (topK=25 raw) ожидаемо ~550-650ms (Flowise queryVectorStore linear по k
// после embedding фазы). Acceptable trade-off для consistent dedup quality.
//
// Adaptive multiplier на topK >= 20 — не делаем сейчас (CATALOG_MAX_TOP_K=50
// и multiplier 5 даёт 250 raw chunks, на верхней границе всё ещё <1s на
// проде. Если deteriorate >1.5s — понизим adaptive до 3 при topK >= 20).
// =============================================================================

export const CATALOG_DEDUPE_OVERFETCH_MULTIPLIER = 5;

// CATALOG_MAX_QUERY_LENGTH = 500 chars — почему 500, а не token-based лимит
// OpenAI text-embedding-3-large (8191 tokens ≈ 30KB ASCII):
// (a) UX — natural language query вряд ли осмыслен >500 chars (одно-два
//     предложения на естественном языке).
// (b) embedding cost cap — без token counter здесь, char-based proxy: 500
//     chars ≈ 150-200 токенов, ~$0.00002/query на text-embedding-3-large
//     ($0.13/1M tokens). Token burst через длинные payload'ы исключён.
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

// Max количество фото в одном запросе. Anthropic Vision API поддерживает
// до 100, но 5 — разумный UX-кап:
// (a) cost — $0.005-0.007/photo × 5 = ~$0.035 на запрос (≈2.5 ₽);
// (b) UX — клиент обычно фотографирует 1-3 ракурса оборудования,
//     5 хватит на «фронт + сбоку + наклейка с моделью + верх + низ»;
// (c) request payload — 5 × 5MB = 25MB декодированных ≈ 35MB base64 +
//     JSON-обёртка → укладывается в 10MB лимит body parser? НЕТ:
//     5 × 7MB = 35MB > 10MB. Нужно либо поднять body limit на /catalog/search
//     до 40MB, либо снизить per-image cap до ~1.5MB. Pragmatic: оставляем
//     5MB per image, body parser limit поднимем до 40MB на этом route.
export const VISION_MAX_IMAGES_PER_REQUEST = 5;

// Universal /catalog/search endpoint — один путь для text/image/combined,
// поэтому throttle ставим conservative (text user не должен ждать, image
// abuse защищён layered defense через budget cap #21 + image-cache #66).
//
// 10/min/IPv6-/64 anonymous: legitimate клиент/менеджер делает 1-2 поиска
// в минуту (вводит запрос → читает результаты ~30 сек → новый запрос).
// 10/min даёт 5× запас для нормального usage. Bot-flood (>10/min из одного
// /64-блока) → 429 Too Many Requests.
//
// IPv6-/64 prefix через IpThrottlerGuard (см. `throttle/extract-ip-tracker.ts`)
// — без этого один провайдер раздаёт 2^64 адресов и throttle bypass'ится.
//
// Authenticated пользователи получат повышенный лимит после auth-модуля
// (#17 в tech-debt). Sketch: × 3 для зарегистрированных, × 10 для дилеров.
export const CATALOG_SEARCH_THROTTLE_LIMIT = 10;
export const CATALOG_SEARCH_THROTTLE_TTL_MS = 60_000;
