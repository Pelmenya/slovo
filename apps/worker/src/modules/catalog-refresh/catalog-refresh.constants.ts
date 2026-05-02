// =============================================================================
// DI токены как Symbol — избегают коллизий с другими модулями worker'а
// которые в будущем могут DI-нить свои Flowise-клиенты с другим конфигом.
// =============================================================================

export const FLOWISE_CLIENT_TOKEN = Symbol('CATALOG_REFRESH_FLOWISE_CLIENT');
export const REDIS_CLIENT_TOKEN = Symbol('CATALOG_REFRESH_REDIS_CLIENT');

// Имя Document Store каталога Аквафор — re-export из libs/common (единый
// source-of-truth с apps/api/catalog). CRM feeder кладёт latest.json в
// slovo-datasets/catalogs/aquaphor/, Flowise S3 File Loader тянет при refresh.
// Store создан вручную в Phase 0 (см. lab journal day 2).
export { CATALOG_AQUAPHOR_STORE_NAME } from '@slovo/common';

// =============================================================================
// Distributed lock — Redis SET NX EX с fence-token (uuid per acquire).
// Защищает от race condition при истечении TTL: если предыдущий refresh
// завис >TTL, второй cron возьмёт lock, первый при finally НЕ должен
// сносить чужой lock — отсюда CAS-pattern через Lua-скрипт.
// =============================================================================

export const CATALOG_REFRESH_LOCK_KEY = 'slovo:catalog-refresh:lock';

// 30 минут — потолок для самого долгого ожидаемого refresh (155 items
// сейчас укладывается в ~5 сек, но запас на рост каталога до 1000+ items).
// При нормальном сценарии lock освобождается раньше через explicit DEL.
// TODO(observability): alert если elapsedMs > LOCK_TTL_SEC * 1000 * 0.8.
export const CATALOG_REFRESH_LOCK_TTL_SEC = 1800;

// Lua-скрипт для атомарного CAS-release: удаляет lock только если value
// совпадает с переданным fence-token'ом. Защищает от снятия чужого lock'а
// если наш TTL истёк и второй процесс уже acquire'нул свой lock.
// Ref: https://redis.io/docs/manual/patterns/distributed-locks/
export const CATALOG_REFRESH_LOCK_RELEASE_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
`.trim();

// =============================================================================
// Cron — каждые 4 часа (00:00, 04:00, 08:00, 12:00, 16:00, 20:00 по локали
// контейнера). См. ADR-007 раздел "Latency invalidation".
// =============================================================================

export const CATALOG_REFRESH_CRON = '0 */4 * * *';

// =============================================================================
// Slovo-orchestrate ingest (PR6.5) — заменил `flowise_docstore_refresh`.
// Worker сам читает latest.json из MinIO + per-item upsert через PlainText
// loader. Причина: Flowise S3 File Loader для application/json идёт в
// isTextBased ветку (не запускает JSONLoader), Custom Metadata jsonpointer'ы
// сохраняются как литералы — search получает мусор. См. lab journal day 2 +
// `docs/architecture/decisions/007-catalog-ingest-via-minio.md` amendment C.
// =============================================================================

// S3-key payload'а в bucket S3_CATALOG_BUCKET (slovo-datasets).
// CRM feeder перезаписывает на каждом cache-reset событии.
export const CATALOG_PAYLOAD_KEY = 'catalogs/aquaphor/latest.json';

// Concurrency для per-item upsert. **Sequential обязателен** — Flowise
// `saveProcessingLoader` внутри `executeDocStoreUpsert` имеет classic
// read-modify-write на `documentstore.loaders` JSON column без транзакции:
// concurrent upserts на тот же store теряют loader-ы (last-write-wins),
// часть upsert'ов падает с HTTP 500. Discovered в PR6.5 validation:
// concurrency=5 дал 80% failure rate на 155 items, concurrency=1 — 100%
// success.
//
// PR9.5 RecordManager update: skip-if-unchanged значимо снижает duty cycle —
// типичный refresh с 5-10 changes/день длится 5-10 sec вместо 90 sec
// (unchanged items skipped without embedding cost).
export const CATALOG_UPSERT_CONCURRENCY = 1;

// Redis HASH для slovo-side mapping externalId → docId. Ключ к idempotent
// re-upsert через Flowise RecordManager:
//   - При first refresh: пусто → upsert without docId → Flowise creates new
//     loader → store returned docId
//   - При repeat refresh: HGETALL → per-item lookup → upsert WITH stored docId
//     → metadata.docId stable → RecordManager hash matches → skip embedding
//
// REMOVED items (в mapping но не в payload) → DELETE loader + HDEL.
//
// Без TTL — mapping живёт пока Document Store существует. При смене store
// (ребрендинг / per-tenant split) — invalidate manually.
export const CATALOG_LOADERS_REDIS_KEY = 'slovo:catalog:loaders';

// Splitter config для PlainText loader. Совпадает с предыдущим S3 File Loader
// setup'ом (Phase 0) — chunkSize 1000, overlap 200. Большинство items
// уложатся в 1 chunk; description'ы товаров — обычно 200-500 chars.
export const CATALOG_SPLITTER_CHUNK_SIZE = 1000;
export const CATALOG_SPLITTER_CHUNK_OVERLAP = 200;

// =============================================================================
// Vision augmentation (#70 / #71 Phase 2 ingest improvement)
//
// Catalog-refresh обогащает товарный contentForEmbedding визуальным описанием
// от Claude Vision. Без этого текстовый caption (функциональные характеристики
// из CRM) не пересекается с Vision-output клиентского фото (визуальные
// характеристики), embeddings лежат в разных частях семантического пространства.
//
// Pipeline: download images from MinIO → sha256 hash → Redis mapping check →
// hit return cached / miss call Flowise augmenter chatflow → save mapping.
//
// Cost projection (155 items × $0.01 augmentation на haiku-4-5 multi-image):
// - Первый refresh: ~$1.55 ≈ 124 ₽ один раз
// - Повторные с hash-cache: 5-10 changed items/мес = ~$0.05/мес = ~4 ₽/мес
// =============================================================================

// Redis HASH `slovo:catalog:vision-augment:<externalId>` → JSON-string с
// {imageHash, visualDescription}. Hash считается от sorted concat(image bytes)
// — стабильный fingerprint для одного и того же набора фото товара.
// REMOVED-sweep дополняется в catalog-refresh: item в mapping но не в payload
// → HDEL (по аналогии с loaderMapping в PR9.5).
export const VISION_AUGMENT_REDIS_KEY = 'slovo:catalog:vision-augment';

// Cap размер одного изображения для augmentation. Реальные товарные фото в
// каталоге Аквафор-Pro — 100-500KB. 5MB — запас ×10. Превышение → skip image
// (продолжаем augmentation с остальными фото; если все skip'нуты → null).
export const VISION_AUGMENT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Сколько изображений отправляется в один Vision call. Anthropic API supports
// больше, но: (1) cost линейный, (2) на >5 фото вырастает hallucination rate
// (Anthropic docs). Multi-image товаров в нашем каталоге ≤10, режем до 5 первых.
export const VISION_AUGMENT_MAX_IMAGES = 5;

// Cost per Vision call (claude-haiku-4-5 conservative). На 5 изображений
// + system prompt ~600 tokens = 8100 input × $1/1M (haiku) = $0.008, +
// 200 output × $5/1M = $0.001. Total ~$0.009. Conservative до $0.01.
// Реальный billing 2 мая показал $0.0026/item — Haiku в 4× дешевле.
export const VISION_AUGMENT_COST_PER_CALL_USD = 0.01;

// Vision call timeout — safety belt поверх FlowiseClient timeout'а
// (REFRESH_FLOWISE_TIMEOUT_MS=5min в catalog-refresh.module.ts).
// 60 сек выбраны не как throttle а как страховка: legitimate multi-image
// Vision на 5 фото может занимать 10-30 сек (Anthropic API jitter), 60s
// = ×2 запас от observed worst-case. Если FlowiseClient timeout сломан
// (config error / future change) — этот local timeout срабатывает раньше
// чем lock-TTL (30 мин) истечёт. Очередь (RMQ-consumer для async augment)
// — правильное long-term решение, но overkill для Phase 2.
export const VISION_AUGMENT_CALL_TIMEOUT_MS = 60_000;

// Per-refresh batch cap на Vision-вызовы. Защита от financial DoS:
// если CRM feeder выкатит 10K items с changed-hash (например EXIF jitter
// сломал idempotency), augmentation сожрёт 10K × $0.01 = $100/cron.
// Cap 500 = $5/refresh worst-case = $30/день при 6 cron'ах. После cap'а
// `augmentItem` возвращает null с warn, refresh продолжается без augment
// для остатка. Item получит augmentation в следующем cron'е.
export const VISION_AUGMENT_MAX_CALLS_PER_REFRESH = 500;

// Hard length cap на augmented description (после Vision call). Защита:
// 1) prompt injection через текст на товарных фото — злоумышленник не
//    может протолкнуть длинный токсичный текст в search response;
// 2) cost — output >300 tokens на простой augment задаче = LLM
//    overflow'нул prompt instruction, лучше обрезать.
export const VISION_AUGMENT_MAX_DESCRIPTION_LENGTH = 500;

// MIME whitelist для Vision input. Anthropic API строго принимает только
// эти 4 формата. SVG/octet-stream/heic/etc → API возвращает 400, тратится
// chatflow_list call + downloaded bytes.
export const VISION_AUGMENT_ALLOWED_MIMES: ReadonlySet<string> = new Set([
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
]);

// Версия модели для augment mapping. При смене модели (Haiku 4.5 → 5.x)
// bump версии → cache miss всех закешированных описаний → re-augment с
// новой моделью. Hash bytes остаётся стабильным, но modelVersion mismatch
// триггерит refresh без необходимости bump'ить весь VISION_AUGMENT_REDIS_KEY.
export const VISION_AUGMENT_MODEL_VERSION = 'haiku-4-5';

// =============================================================================
// Защитные ограничения от malicious / broken feeder (PR6.5 security follow-up)
// =============================================================================

// Whitelist Flowise vector tables которые worker'у разрешено TRUNCATE'ить.
// `isValidPostgresIdentifier` regex защищает от SQL injection через формат,
// но НЕ от blast-radius: если admin / compromised Flowise API-key изменит
// `vectorStoreConfig.config.tableName` на `User` / `accounts` — Postgres
// (с двойным цитированием) разрешит, и worker уничтожит наши данные.
// Жёсткий whitelist — защита-в-глубину: даже корректный по формату
// identifier должен быть в этом списке.
//
// Расширение: добавить новое имя при создании 2-го Document Store с другим
// каталогом (per-tenant в будущем). Для multi-tenant — заменить на per-store
// маппинг через Prisma (см. tech-debt про multi-vectorstore).
export const ALLOWED_VECTOR_TABLES: ReadonlySet<string> = new Set(['catalog_chunks']);

// Max размер latest.json payload (100MB). Worker буферит весь stream в RAM
// (`Buffer.concat`), поэтому без cap'а compromised MinIO IAM-ключ или баг в
// feeder → multi-GB payload → OOM kill worker → cron ломается, lock висит.
// 100MB = ×600 от ожидаемых ~150KB на 155 items, оставляет запас на рост.
export const CATALOG_MAX_PAYLOAD_BYTES = 100 * 1024 * 1024;
