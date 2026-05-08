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
// Oversample при наличии post-filters. *5 — эмпирическая оценка: при
// `regionContains='Московская'` hit rate среди 15 504 ≈ 14%, для top-K=10 нужно
// ≥10/0.14≈72 кандидата. *5 для top-K=10 даёт 50 — обычно хватает. При top-K=50
// упрётся в MAX_FETCH_K=250 (защита от unbounded retrieval из Flowise/pgvector;
// cosine linear по top-K, на 15 504 chunks 250 запросов ≈ 1s).
// Переезд из service.ts в constants 2026-05-07 для consistency с
// SIMILAR_THROTTLE_LIMIT и других tuning-knobs.
// =============================================================================

export const SIMILAR_OVERSAMPLE_FACTOR = 5;
export const SIMILAR_MAX_FETCH_K = 250;

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

// =============================================================================
// Heatmap endpoint (4.A.1) — агрегированная тепловая карта качества воды по grid.
//
// Архитектурно отличается от similar: ходит напрямую в водо-БД через Prisma raw
// SQL + PostGIS (ST_MakeEnvelope + bbox через GIST индекс на geo_point), не
// через Flowise. Параметры (5 значений) — синтетический `risk` рассчитывается
// в SQL по той же формуле что в derived (см. heatmap.service.ts).
//
// Throttle 120/min/IP — мягче чем similar, потому что пользователь будет
// часто переключать pills параметра (5 параметров × 1 viewport ≈ 5 запросов,
// + при пане карты), и стоимость одного запроса ~50-100мс на чистом SQL
// (без LLM/Flowise overhead). Cost атаки околонулевой.
//
// Cache TTL 24ч — данные стабильны, derived пересчитывается ручным запуском
// experiments/water-analysis-dataset/scripts/05-normalize.ts. Когда автоматизируем
// daily ingest — снижу до 6ч + bust на завершении job.
// =============================================================================

export const HEATMAP_THROTTLE_LIMIT = 120;
export const HEATMAP_THROTTLE_TTL_MS = 60_000;
export const HEATMAP_CACHE_TTL_SECONDS = 24 * 60 * 60;
export const HEATMAP_REDIS_TOKEN = Symbol('WATER_ANALYSIS_HEATMAP_REDIS');

// Bbox bounds. -180..180 lon / -90..90 lat — стандартные WGS84 границы.
// В реальном использовании prostor-app будет посылать МО bbox (37-39° lon,
// 54-57° lat), но не bound'им namespace на МО — endpoint остаётся generic
// для будущих регионов / national-scope.
export const BBOX_LAT_MIN = -90;
export const BBOX_LAT_MAX = 90;
export const BBOX_LON_MIN = -180;
export const BBOX_LON_MAX = 180;

// Grid step в градусах.
//
// Минимум **0.02° (~2.2 км)** — НЕ 0.005° как изначально планировалось.
// Reason: PII trade-off. На grid=0.005° (555 м) и count=1 в ячейке возможна
// identification конкретного дома (ahunter geocoding точность ~200м для
// house-level, аналогичный grid → пинпойнт). На 0.02° (2.2 км) identification
// нереалистична: square ≥10 домовладений даже в коттеджных посёлках МО.
// EDA на water_analysis (8 мая 2026): 60% cells на grid=0.005° имеют count=1
// (т.е. identification realistic), на grid=0.02° — 46%, но square уже
// «деревня» уровень. K-anonymity через минимальный grid вместо HAVING
// COUNT>=K — не выкидываем 50% контента (экстракция данных стоила денег
// и дней работы, не теряем результат).
//
// Максимум 0.5° (~55 км) — overview всей МО / соседних регионов.
//
// Default 0.05° (~5.5 км) — баланс детализации и кол-ва точек, identification
// абсолютно невозможна.
export const GRID_MIN_DEG = 0.02;
export const GRID_MAX_DEG = 0.5;
export const GRID_DEFAULT_DEG = 0.05;

// Heatmap params — все 22 canonical paramCode из СанПиН 1.2.3685-21 + synthetic
// `risk` (weighted % от ПДК). Любой из этих может быть param= в query. Всё что
// вне списка — 400 (Bad Request).
//
// Whitelist важно: не пускаем юзера в произвольный params.* JSONB extract,
// чтобы не получить SQL-injection-подобный путь через jsonb operator при
// невалидированном keyname (defensive layer поверх $queryRaw параметризации).
//
// NB: parameters с pdk=null (temperature, electrical_conductivity) или
// range-type pdk (ph) — heatmap для них всё равно имеет смысл (показать
// distribution), но статусирование (good/mid/bad) другое — см. heatmap.service
// resolvePdk + statusFor.
//
// Источник списка — `WATER_PARAMS` из `@slovo/water-blank-extraction` (СанПиН
// справочник, single source of truth). Дублируем здесь литералом для type-safety
// `THeatmapParam` (TS не выводит string-literal union из runtime массива).
// =============================================================================
// Predict endpoint (4.A.2, USP-1) — kNN-прогноз химии для нового адреса БЕЗ
// собственного анализа. Top-K ближайших соседей в радиусе → distance-weighted
// average + P10/P90 percentile interval.
//
// Throttle 60/min/IP — мягче heatmap (predict дороже на ST_DWithin scan + per-row
// jsonb extraction в TS, ~50-200мс vs 50-100мс heatmap), и legitimate use-case
// — клиент 1-3 запроса при выборе оборудования, не браузинг карты.
//
// Cache TTL 5 мин — координаты юзера могут shift при пане карты, но реальный
// USP сценарий (ввёл свой адрес → получил прогноз) дублируется редко. 5 мин
// достаточно для retry/refresh без штрафа на cache hit-rate.
// =============================================================================

export const PREDICT_THROTTLE_LIMIT = 60;
export const PREDICT_THROTTLE_TTL_MS = 60_000;
export const PREDICT_CACHE_TTL_SECONDS = 5 * 60;
export const PREDICT_REDIS_TOKEN = Symbol('WATER_ANALYSIS_PREDICT_REDIS');

// Top-K bounds. K=20 default — баланс sample size (для percentile надо ≥10 точек,
// чтобы P10/P90 был стабилен) и SQL latency (LIMIT 20 на 15 504 записях ~10мс).
// Min=5 — ниже percentile interval становится noisy. Max=100 — выше уже не
// «локальный» kNN, и clay смешивается с известняковым горизонтом.
export const PREDICT_DEFAULT_K = 20;
export const PREDICT_MIN_K = 5;
export const PREDICT_MAX_K = 100;

// Radius search bounds. Дефолт 50км — типичный «локальный» bbox для МО (одна
// область). Min 1км — точечный поиск (для тестов / валидации). Max 200км —
// полу-глобальный fallback при отсутствии данных рядом.
export const PREDICT_DEFAULT_RADIUS_KM = 50;
export const PREDICT_MIN_RADIUS_KM = 1;
export const PREDICT_MAX_RADIUS_KM = 200;

// Inverse-distance weighting parameter. weight = 1 / (1 + dist_km / IDW_SCALE).
// IDW_SCALE=10 → точка в 0км имеет weight=1, в 10км weight=0.5, в 50км weight≈0.17.
// Меньше IDW_SCALE → быстрее затухание (больше bias на ближайших), больше →
// плавнее (шум усредняется).
export const PREDICT_IDW_SCALE_KM = 10;

// Recency-weight half-life в годах. weight ∝ exp(-age_years / RECENCY_HALF_LIFE).
// 5 лет — анализ 5-летней давности имеет half-weight, 10-летней ~25%. Это даёт
// наклон к свежим данным без полного отбрасывания старых (которых только
// 2020-2026, всё актуально).
export const PREDICT_RECENCY_HALF_LIFE_YEARS = 5;

export const HEATMAP_PARAMS = [
    // Органолептические
    'odor',
    'color',
    'turbidity',
    // Обобщённые
    'tds',
    'hardness_total',
    'permanganate_oxidizability',
    'ph',
    // Неорганические
    'ammonium',
    'iron_total',
    'manganese',
    'magnesium',
    'calcium',
    'nitrates',
    'nitrites',
    'sulfates',
    'sulfides',
    'chlorides',
    'fluorides',
    'hydrogen_sulfide',
    'alkalinity_total',
    // Физические (без ПДК)
    'temperature',
    'electrical_conductivity',
    // Synthetic — weighted % от ПДК по 4 ключевым параметрам
    'risk',
] as const;
export type THeatmapParam = (typeof HEATMAP_PARAMS)[number];
