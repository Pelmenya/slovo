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
