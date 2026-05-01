// =============================================================================
// Имя Document Store в Flowise для каталога Аквафор.
// CRM feeder кладёт latest.json в slovo-datasets/catalogs/aquaphor/, Flowise
// S3 File Loader тянет его при refresh. Этот store создан вручную в Phase 0
// (см. lab journal day 2, storeId: aec6b741-8610-4f98-9f5c-bc829dc41a96).
// =============================================================================

export const CATALOG_AQUAPHOR_STORE_NAME = 'catalog-aquaphor';

// =============================================================================
// Distributed lock — Redis SET NX EX. Защищает от повторного запуска cron'а
// если предыдущий refresh ещё не завершился (refresh синхронный, на 1000+
// items может занять минуты, см. ADR-007 + lab journal).
// =============================================================================

export const CATALOG_REFRESH_LOCK_KEY = 'slovo:catalog-refresh:lock';

// 30 минут — потолок для самого долгого ожидаемого refresh (155 items
// сейчас укладывается в ~5 сек, но запас на рост каталога до 1000+ items).
// При нормальном сценарии lock освобождается раньше через explicit DEL.
export const CATALOG_REFRESH_LOCK_TTL_SEC = 1800;

// =============================================================================
// Cron — каждые 4 часа (00:00, 04:00, 08:00, 12:00, 16:00, 20:00 по локали
// контейнера). См. ADR-007 раздел "Latency invalidation".
// =============================================================================

export const CATALOG_REFRESH_CRON = '0 */4 * * *';
