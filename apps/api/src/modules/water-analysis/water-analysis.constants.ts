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
// Cache key version prefix для всех water-analysis Redis cache keys.
//
// Bump при breaking changes в response shape ИЛИ при значимом изменении data
// source (например, canonical merge 2026-05-13 — может изменить exceedsPct на
// 987 critical cells, stale pre-canonical cached responses в Redis сосуществуют
// с новыми до TTL expire 24h).
//
// Bump history:
//   v1 — initial Phase 4 backend (2026-05-08)
//   v2 — after canonical merge в commit 57b0879 (2026-05-13). Force invalidation
//        cached responses для prod-deploy — иначе клиенты получают pre-canonical
//        severity-status для тех 987 critical cells до 24h.
//   v3 — aquifer-stats response shape fix (2026-05-13): `totalWells` теперь real
//        bbox count через `COUNT(*) OVER()` window function (раньше = samplesUsed
//        после LIMIT, misleading). Bump чтобы prod-deploy получил honest counts.
//   v4 — pdkExceedanceRatio + max/medianExceedanceRatio fields added (2026-05-14):
//        /points response получил `pdkExceedanceRatio: Record<paramCode, number>`,
//        /heatmap/cell `ParamBreakdownDto` получил `maxExceedanceRatio` + `medianExceedanceRatio`.
//        Поддерживает фронт-фичу «×8.3 ПДК» в PointPopup / CellPopup (claude design
//        review 2026-05-14, P0.2). Bump чтобы клиент не получил stale response без
//        новых полей и не ломался на undefined.
// =============================================================================
export const WATER_ANALYSIS_CACHE_VERSION = 'v4';

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
// Aquifer layers — водоносные горизонты МО.
//
// Эмпирические границы по геологии Подмосковья:
//   - 0-15м: верховодка / песчаный приповерхностный (часто колодцы)
//   - 15-50м: основной песчаный (типичная частная скважина)
//   - 50-100м: песчано-известняковый (граница на смене породы)
//   - 100-200м: известняковый (артезианский базовый)
//   - 200м+: глубокий артезианский (редко в МО, скорее Tula/Ярославская)
//
// Используется в /predict (mostLikelyAquiferLayer), /depth-map (bucket-распределение
// в каждой cell), /aquifer-stats (data-driven verification через GMM).
//
// Эмпирические границы — не из СанПиН/ГОСТ, а из practitioner-knowledge МО
// (источник: разработчик + общая гидрогеология). При появлении более точного
// справочника — обновить здесь, остальные места читают через `AQUIFER_LAYERS`.
// =============================================================================

export type TAquiferLayer = {
    /** Минимальная глубина (включительно). */
    min: number;
    /** Максимальная глубина (исключительно). Для последнего слоя — Infinity. */
    max: number;
    /** UI label с диапазоном + русским названием горизонта. */
    label: string;
    /** Стабильный id для filter/index, не зависит от перевода label. */
    id: string;
};

export const AQUIFER_LAYERS: ReadonlyArray<TAquiferLayer> = [
    { id: 'top_water', min: 0, max: 15, label: '0-15m / Верховодка' },
    { id: 'sandy', min: 15, max: 50, label: '15-50m / Песчаный' },
    { id: 'sandy_limestone', min: 50, max: 100, label: '50-100m / Песчано-известняковый' },
    { id: 'limestone', min: 100, max: 200, label: '100-200m / Известняковый' },
    { id: 'artesian', min: 200, max: Infinity, label: '200m+ / Артезианский' },
];

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

// =============================================================================
// Depth-map endpoint (4.A.3, USP-4 base) — карта глубин скважин/колодцев по grid.
//
// Архитектурно похоже на heatmap: те же bbox/grid агрегации через PostGIS, но
// без params->> extraction — depth_meters это column. Per cell median/P25/P75
// глубины + count + aquiferLayers bucket-распределение.
//
// Audience: бурильщики / копатели колодцев / гидрогеологи / девелоперы.
// Coverage data: well 76.7% (7 884 точек), well_dug 41.2% (742 точек).
//
// Throttle/cache: те же что heatmap (depth-map менее частый запрос — drilling
// клиент 1-3 раза при выборе участка, не браузинг каждые 100мс).
// =============================================================================

export const DEPTH_MAP_THROTTLE_LIMIT = 120;
export const DEPTH_MAP_THROTTLE_TTL_MS = 60_000;
export const DEPTH_MAP_CACHE_TTL_SECONDS = 24 * 60 * 60;
export const DEPTH_MAP_REDIS_TOKEN = Symbol('WATER_ANALYSIS_DEPTH_MAP_REDIS');

// intakeType filter — какие источники учитывать. `all` включает well+well_dug
// (municipal/spring/river depth не имеет смысла). Default 'well' — самый
// частый use-case для бурильщиков. 'well_dug' — для колодцев (мелкие, в МО
// обычно <15м).
//
// Унифицированный shared `INTAKE_TYPE_FILTER_VALUES` + `TIntakeTypeFilter`
// в `_shared/intake-filter.ts` используется во всех drilling-endpoints
// (depth-map, depth-predict, aquifer-stats) — раньше было 2 дубликата
// + чужой namespace в aquifer-stats. Объединено 2026-05-08.

// =============================================================================
// Depth-predict endpoint (4.A.4, USP-4) — kNN-прогноз глубины бурения для нового
// адреса. Reuses тот же подход что /predict (top-K + IDW + recency weighting +
// percentile interval), но aggregation поверх depth_meters single column.
//
// Дефолты те же что /predict (5min cache, 60/min throttle, k=20, radius=50км,
// IDW=10км, recency=5yr). Дублируем константы для per-endpoint независимой
// настройки в будущем (drilling-юзеры могут хотеть другой k или radius).
// =============================================================================

export const DEPTH_PREDICT_THROTTLE_LIMIT = 60;
export const DEPTH_PREDICT_THROTTLE_TTL_MS = 60_000;
export const DEPTH_PREDICT_CACHE_TTL_SECONDS = 5 * 60;
export const DEPTH_PREDICT_REDIS_TOKEN = Symbol('WATER_ANALYSIS_DEPTH_PREDICT_REDIS');

export const DEPTH_PREDICT_DEFAULT_K = 20;
export const DEPTH_PREDICT_MIN_K = 5;
export const DEPTH_PREDICT_MAX_K = 100;

export const DEPTH_PREDICT_DEFAULT_RADIUS_KM = 50;
export const DEPTH_PREDICT_MIN_RADIUS_KM = 1;
export const DEPTH_PREDICT_MAX_RADIUS_KM = 200;

export const DEPTH_PREDICT_IDW_SCALE_KM = 10;
export const DEPTH_PREDICT_RECENCY_HALF_LIFE_YEARS = 5;

// intakeType filter — используется через shared `INTAKE_TYPE_FILTER_VALUES` /
// `TIntakeTypeFilter` из `_shared/intake-filter.ts` (унифицировано 2026-05-08).
// Default 'well' — самая частая drilling-задача (скважина 30-80м). 'well_dug'
// для копателей колодцев (мелкие 5-15м, артель копает а не бурит). 'all' —
// общий обзор без preference.

// =============================================================================
// Points endpoint (4.A.5) — отдельные анализы (не агрегаты) для high-zoom
// детализации карты. UI рисует individual точки с popup'ом когда юзер
// зумит на район.
//
// Throttle 120/min/IP (как heatmap — лёгкий read-endpoint).
// Cache TTL 1 час — данные derived обновляются ручным запуском normalize, но
// `/points` отдаёт «свежее» что в БД, поэтому короче чем heatmap (24ч).
// =============================================================================

export const POINTS_THROTTLE_LIMIT = 120;
export const POINTS_THROTTLE_TTL_MS = 60_000;
export const POINTS_CACHE_TTL_SECONDS = 60 * 60;
export const POINTS_REDIS_TOKEN = Symbol('WATER_ANALYSIS_POINTS_REDIS');

// Limit bounds. Default 200 — достаточно для one viewport detailed view (~grid
// 0.01-0.05°, не больше 200 пинов помещается на экране без caos). Max 500 —
// API max, чтобы не отвечать 5MB JSON. Min 10 — sanity.
export const POINTS_DEFAULT_LIMIT = 200;
export const POINTS_MIN_LIMIT = 10;
export const POINTS_MAX_LIMIT = 500;

// Coordinate rounding для PII protection — те же 0.005° (~500м) что в /similar,
// см. memory `project_water_analysis_pii_strategy`. На /points это критично
// потому что отдаём отдельные анализы, не aggregated cells.
export const POINTS_COORD_ROUND_GRID = 200; // 1° / 200 = 0.005°

// =============================================================================
// Equipment-suggest endpoint (4.A.6 USP-2 flagship cross-domain) — рекомендация
// фильтра по координатам через kNN-прогноз химии + catalog vector search.
//
// Pipeline: координаты → predict (interval-aware) → identify problems
// (`pdkStatus IN ('borderline', 'unsafe')`) → build natural-language query →
// catalog vector search.
//
// Throttle 10/min/IP — обусловлен **budget-amplification** риском (security-auditor
// 2026-05-08): один cache-miss request = 1 predict SQL + 3 параллельных Flowise
// vectorstoreQuery × OpenAI text-embedding-3-large. На rotating cache-key (lat
// 3-знака × lon 3-знака × topK = 20 000 уникальных за 1° квадрат) атакующий
// тратит ~$1.6/IP/cycle. С 30/min ушло бы ~$160/час на сотне IP, с 10/min ~$53.
// Legitimate use-case (клиент выбирает фильтр) укладывается в 1-3 запроса/мин.
// Прежний throttle 30/min изначально ставился без учёта Promise.all-fanout.
//
// Cache TTL 10 мин — короче чем predict (5min) потому что зависит от двух
// stale sources (water archive + catalog), но дольше чем чистый predict
// смысла нет — координаты не дублируются массово.
// =============================================================================

export const EQUIPMENT_SUGGEST_THROTTLE_LIMIT = 10;
export const EQUIPMENT_SUGGEST_THROTTLE_TTL_MS = 60_000;
export const EQUIPMENT_SUGGEST_CACHE_TTL_SECONDS = 10 * 60;
export const EQUIPMENT_SUGGEST_REDIS_TOKEN = Symbol('WATER_ANALYSIS_EQUIPMENT_SUGGEST_REDIS');

export const EQUIPMENT_SUGGEST_DEFAULT_TOP_K = 5;
export const EQUIPMENT_SUGGEST_MIN_TOP_K = 1;
export const EQUIPMENT_SUGGEST_MAX_TOP_K = 20;

// Per-problem catalog search tuning. Сколько проблем (top-N severity) брать
// для отдельных targeted queries и сколько top результатов из каждой problem.
// Произведение MAX_PROBLEM_QUERIES × PER_PROBLEM_K = budget-cap на Flowise
// vectorstoreQuery round-trips per request (security-auditor 2026-05-08:
// raw 30/min × 3 queries = 90/min; теперь 10/min × 3 = 30/min).
//
// MAX_PROBLEM_QUERIES=3 — баланс targeted-variety и Flowise round-trip latency
// (3 параллельных через Promise.all ≈ ~600ms wall-clock vs 1.8s sequential).
// PER_PROBLEM_K=2 — после dedup даёт обычно 4-5 уникальных рекомендаций.
export const EQUIPMENT_SUGGEST_MAX_PROBLEM_QUERIES = 3;
export const EQUIPMENT_SUGGEST_PER_PROBLEM_K = 2;

// =============================================================================
// Aquifer-stats endpoint (4.B.6 USP-4 deep-dive) — стратифицированная статистика
// по 5 водоносным горизонтам в bbox.
//
// Audience: drilling-юзеры (бурильщики/копатели/гидрогеологи) которые хотят
// знать «какая обычно вода на каждом горизонте в этом районе» до бурения.
//
// Per layer:
//   - count + pct (% от total wells/well_dug в bbox)
//   - median depth (в каком диапазоне типично бурят на этом слое)
//   - typical chemistry (median 22 параметров) — что ожидать на этой глубине
//
// Использует те же AQUIFER_LAYERS bucket'ы что /depth-map, /predict (mostLikelyLayer),
// /depth-predict (layerDistribution). Это **deep-dive** версия: добавляет
// типичную химию per layer, не только counts.
//
// Throttle 60/min/IP — endpoint heavier чем depth-map (20+ aggregations per bucket
// в TS), но light read overall (~150-300мс). Cache TTL 24ч (стабильные данные).
// =============================================================================

export const AQUIFER_STATS_THROTTLE_LIMIT = 60;
export const AQUIFER_STATS_THROTTLE_TTL_MS = 60_000;
export const AQUIFER_STATS_CACHE_TTL_SECONDS = 24 * 60 * 60;
export const AQUIFER_STATS_REDIS_TOKEN = Symbol('WATER_ANALYSIS_AQUIFER_STATS_REDIS');

// Sample limit для aggregation. SQL pull лимитирован чтобы avoid huge JSON
// responses — при 8000+ точек и 20+ params на каждой это ~10MB jsonb. Берём
// 5000 максимум, ORDER BY sample_date DESC — свежие важнее. На 8626 точек МО
// это значит мы пропустим самые старые ~3.5K — ОК для типичной chemistry.
export const AQUIFER_STATS_SAMPLE_LIMIT = 5000;

// =============================================================================
// Heatmap cell-detail endpoint — детали отдельной cell для popup на карте
// (popup открывается при тапе по cell, отдаёт breakdown 22 параметров с
// per-paramу exceedsCount/max/median/pdk).
//
// Используется фронтом prostor-app для popup на карте — клиент тапает на
// зону, видит «вот эти 3 параметра превышают, эти 19 в норме, можно подобрать
// фильтр». Cheap operation — single cell query, 1× per click event.
//
// Throttle 60/min/IP (легче heatmap — popup редкий event, не браузинг).
// Cache TTL 1 час (данные стабильные derived dataset).
// =============================================================================

export const CELL_DETAIL_THROTTLE_LIMIT = 60;
export const CELL_DETAIL_THROTTLE_TTL_MS = 60_000;
export const CELL_DETAIL_CACHE_TTL_SECONDS = 60 * 60;
export const CELL_DETAIL_REDIS_TOKEN = Symbol('WATER_ANALYSIS_CELL_DETAIL_REDIS');

// Сколько top-N проблемных параметров возвращать в `topProblems[]`. 5 покрывает
// типичный кейс «1-3 проблемы» с запасом — больше 5 на popup'е визуально шум.
export const CELL_DETAIL_TOP_PROBLEMS_N = 5;

// Cap на rows внутри cell — fetch'им до 200 анализов в bbox cell для aggregation.
// На реальных данных типично 1-30 анализов в cell (grid 0.05° = ~5×5км). 200 —
// safety upper для случая когда юзер тапает на огромную cell (grid=0.5°).
export const CELL_DETAIL_MAX_ROWS = 200;

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
    // Composite — `max severity` from any regulated param (exceedsPct cell =
    // % rows в cell где хотя бы один нормируемый paramOK > ПДК).
    // UX «все проблемы видно сразу», когда юзер хочет overview без выбора
    // конкретного param. Реализовано в heatmap.service `runAllProblemsQuery`.
    'all_problems',
    // Density — игнорирует ПДК, просто COUNT анализов в cell. UX «где у нас
    // вообще данные, а где нет». Шкала: 0/sparse(1-5)/medium(6-15)/dense(16+).
    // Wow для демо «мы покрыли весь МО». Реализовано в `runCoverageQuery`.
    'coverage',
] as const;
export type THeatmapParam = (typeof HEATMAP_PARAMS)[number];

// Coverage thresholds для grey-scale density на фронте.
// На реальных данных МО (886 cells, grid 0.05°): median count ~10-15, max ~80.
// 1-5 — sparse (отдалённые районы), 6-15 — medium (типичный пригородный
// район), 16+ — dense (Москва-центр, Раменское, Видное).
export const COVERAGE_MID_COUNT = 5;
export const COVERAGE_DENSE_COUNT = 15;
