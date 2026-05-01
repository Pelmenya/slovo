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
// Trade-off: 155 items × ~1.5sec = ~4 мин на refresh. Cron 4ч → ~1.5%
// duty cycle, нормально. При росте каталога до 1000+ items придётся
// (a) batch'ить items в один loader через splitter-aware text format,
// (b) использовать Flowise QUEUE_MODE с Bull (но это требует Redis в Flowise),
// (c) форкнуть Flowise + добавить row-level lock в saveProcessingLoader.
export const CATALOG_UPSERT_CONCURRENCY = 1;

// Splitter config для PlainText loader. Совпадает с предыдущим S3 File Loader
// setup'ом (Phase 0) — chunkSize 1000, overlap 200. Большинство items
// уложатся в 1 chunk; description'ы товаров — обычно 200-500 chars.
export const CATALOG_SPLITTER_CHUNK_SIZE = 1000;
export const CATALOG_SPLITTER_CHUNK_OVERLAP = 200;
