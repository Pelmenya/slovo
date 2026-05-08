# PROSTOR Water Pivot — карта-first + капля как brand-якорь

> **Статус:** 🟡 Draft — ожидает согласования с руководителем Аквафор по product-positioning. Не начинать код Phase 2-4 до approve.
> **Дата:** 8 мая 2026.
> **Связи:** [aquaphor-status-2026-05-07](../management/aquaphor-status-2026-05-07.md) · [water-analysis](water-analysis.md) · [vision-catalog-search](vision-catalog-search.md)
> **Repo для реализации:** `prostor-app` (Next.js 16, FSD), `crm-aqua-kinetics-back` (NestJS), бэкенд `slovo-api` (NestJS, /water-analysis/* + /catalog/search)

---

## Идея в одной фразе

**Перепозиционировать prostor-app из «онлайн-магазина фильтров» в «карта качества твоей воды + умный AI-помощник» — вписываясь в концепцию руководителя Аквафор «Клуб чистой воды».** Каталог становится conversion-step, главный экран — интерактивная карта с heatmap качества воды. Фирменный знак — **капля воды + sparkle** (AI-маркер) — везде: иконка PWA, фавикон, app-icon, FAB на карте, кнопка bottom-nav «Вода».

---

## Как вписываемся в концепцию «Клуб чистой воды»

Идея экосистемы «клуба чистой воды» от руководителя Аквафор (озвучена 8 мая 2026) — основа продуктовой стратегии. Наш pivot не «параллельная фича», а **прямое отражение этой концепции в UX**:

| Элемент клуба чистой воды | Как реализуется в prostor-app |
|---|---|
| **«Клуб»** — сообщество вокруг общей темы | Карта-first → клиент видит «членов клуба» (анализы соседей) → чувство сообщества вокруг воды, не одиночная покупка фильтра |
| **«Чистой воды»** — центральная ценность | Капля + sparkle как brand-якорь везде. PWA-иконка, favicon, FAB, header → вода = PROSTOR ассоциация на каждом тапе |
| **«Экосистема»** — много связанных сервисов | Карта (heatmap) + анализы + каталог + AI-помощник (vision search) + (будущее) специалист по водоочистке + рекомендации оборудования по аналогии — всё связано через одну каплю-кнопку |
| **«Вступление в клуб»** — onboarding | Карта главная для нового юзера: видит проблемы соседей → добавляет свой адрес → получает свою воду на карте → становится «членом» |
| **AI-помощник как добавленная ценность** | Sparkle на капле — не decoration, а функциональный маркер «здесь работает AI». Vision-поиск, поиск похожих анализов, тепловая карта — всё под одним символом |

**Чего пока нет в pivot, но есть в идее клуба** (можно расширять отдельными фазами после MVP):
- Membership / тиры участников
- Reward-система за анализы / отзывы
- Community feed «у моего соседа поставили обезжелезиватель ОС-15 за 2024»
- Notifications «у соседей в радиусе 5 км появился новый анализ — посмотри»

Эти фичи — **естественное расширение**, не блокеры для текущих 5 фаз.

---

## Зачем

0. **Синхронизация с vision руководителя — «Клуб чистой воды».** Это главное обоснование. Pivot — не наша внутренняя продуктовая идея, а UX-материализация уже существующей стратегической концепции. Карта-first + капля = клуб становится visible / tangible для клиента, а не абстрактным маркетинговым лозунгом.
1. **Психология первого визита.** Сейчас клиент заходит → видит 8 категорий каталога → паралич выбора. С картой → сразу видит «у соседей вода плохая по железу» → motivation, конкретный сигнал.
2. **AI-positioning.** Sparkle на капле говорит «это умное приложение, не просто магазин». Differentiator vs Wildberries / OZON / каталоги дилеров.
3. **Brand-якорь капля везде.** Узнаваемость: PWA-иконка на homescreen → favicon в табе → header в шапке → FAB на карте → empty-state в поисках. Ассоциация «PROSTOR = вода».
4. **Каталог как conversion-step, не main entry.** Когда клиент уже понимает зачем фильтр (увидел красную зону на карте) — каталог конвертирует в покупку лучше чем сегодня.
5. **PWA install rate.** Красивая фирменная иконка повышает % installation на homescreen, что даёт recurring engagement без рекламы.

---

## Что строим — 3 модуля

### Модуль A — Brand foundation (капля + sparkle)

- Извлечь / нарисовать SVG капли с искрой из исходника `PROSTOR-Smart-Search.html` (Pencil bundler)
- 3 цветовых варианта (OKLCH из mockup'а): `oklch(72% 0.16 232)` → `oklch(58% 0.22 258)` → `oklch(40% 0.26 270)`
- 4 размера использования: 20 px inline / 28 px header / 48 px empty-state / 72 px onboarding
- 5 PNG для PWA: 192/512/180 (iOS Touch) / 152 (iPad) / 120 (iPhone retina) + Maskable Android
- Variations: outline (inactive nav), filled (active nav), gradient (FAB / hero)
- Обновить `prostor-app/public/`: `favicon.ico`, `manifest.json`, иконки

### Модуль B — Bottom-nav «Вода» с каплей FAB

- Заменить текущий `(web)/layout.tsx` bottom-nav `[Каталог] [Корзина]` (2 вкладки) на `[Каталог] [💧 Вода (FAB)] [Корзина]` (3 вкладки, центральная FAB-style)
- FAB-style — капля визуально доминирует, выделяется как primary action (TikTok / Instagram pattern)
- Иконка капли: gradient + лёгкая анимация sparkle на active state
- Active vs inactive — outline (inactive) / filled gradient (active)
- Touch target ≥ 44×44 (Apple HIG)

### Модуль C — Карта главная `/water` route

- Новый view `views/water-map/` + route `app/(web)/water/page.tsx`
- maplibre-gl 5.20 (уже стоит в prostor-app)
- Базовый layer: OSM CartoDB Voyager
- Heatmap layer: `/water-analysis/heatmap?param=...&bbox=...` от slovo-api
- Pills selector параметра: Жёсткость / Железо / Марганец / TDS / Risk-score
- Toggle «Похожие анализы рядом» с radius-pills (5/10/25/50 км)
- Синий пин клиента (если есть real-estate с координатами) + зелёный radius circle
- Click на cell → popup с метриками + CTA «Подобрать оборудование»
- Onboarding overlay на первый запуск
- 3D-tilt включён (бонусная maplibre фича)
- 3 viewport адаптация: iPhone (bottom-sheet) / iPad (side-drawer) / Desktop (sidebar)

### (Опц.) Модуль D — Smart landing redirect

- `(web)/page.tsx` сейчас редирект на `/catalog`
- Меняем на state-aware:
  - Юзер с real-estate (есть координаты) → `/water` (видит свою воду)
  - Без real-estate → `/catalog` (как сейчас)
  - Опционально A/B-тест map-first vs catalog-first

---

## Что уже готово (фундамент)

- ✅ slovo-api endpoint `POST /water-analysis/similar` — комбо гео+семантика
- ✅ slovo-api endpoint `POST /catalog/search` — vision search
- ✅ Архив 15 504 анализов с координатами в БД (97.6%)
- ✅ Каталог 155 товаров с Vision-augmented описаниями
- ✅ Heatmap-прототипы desktop (`prostor-heatmap.html`) + mobile-first 3 viewport (`prostor-heatmap-mobile-standalone.html`)
- ✅ Smart-Search дизайн-mockup от claude design (`PROSTOR-Smart-Search.html`) — там и капля
- ✅ prostor-app stack готов: Next.js 16, maplibre-gl 5.20, TanStack Query, daisyui, FSD
- ✅ FSD entities/real-estate уже знает water-source, water-intake-point
- ✅ slovo-api endpoint `/water-analysis/heatmap` — **реализован 8 мая 2026** (вместе с 6 другими endpoints в Phase 4)

---

## Phases с чек-боксами прогресса

### Phase 1 — Согласование с руководителем Аквафор

> **Решение разработчика 8 мая 2026:** делаем спекулятивно (без предварительного approve), показываем работающее. Pitch с готовым демо сильнее абстрактной презентации — руководитель видит карту с каплей в реальном prostor-app, а не на mockup. Phase 1 переведена в **отметочный статус** (post-факт документация решения), не блокирует Phase 2-6.

- [x] **Решение** — делаем без блокирующего approve, показываем результат (8 мая 2026)
- [ ] Демо для руководителя после Phase 3-4 (карта в prostor-app + капля везде)
- [ ] Получить feedback и финальное решение по landing pivot (Phase 5)

**Risk acknowledged:** если руководитель скажет «не подходит» после demo — будет потрачено ~5-7 дней работы. Mitigation: Phase 2-3 имеют независимую ценность (иконка PWA / новая вкладка nav могут существовать без map-first landing), не выкинутся даже при reject.

### Phase 2 — Brand foundation (1-2 дня, low-risk) — ✅ В РАБОТЕ

- [x] Извлечь SVG капли из `PROSTOR-Smart-Search.html` (через Playwright `getElementsByTagName('svg')` после рендера Pencil-bundler) — каноничный 48×48 viewBox
- [x] Сохранить SVG-источник в `prostor-app/public/icons/water-drop.svg` с OKLCH gradient
- [x] Создать maskable-вариант `water-drop-maskable.svg` (192×192 viewBox + safe-zone scale 0.6)
- [x] Сгенерировать PNG-иконки через Playwright canvas (16/32/72/120/152/180/192/512) — рендеринг OKLCH через Chromium корректный
- [x] Создать maskable PNG для Android adaptive (192/512 с background gradient)
- [x] Заменить `prostor-app/src/app/favicon.ico` на `src/app/icon.png` (Next.js File Conventions)
- [x] Создать `src/app/apple-icon.png` (180×180, Next.js auto-routed)
- [x] Обновить `prostor-app/public/manifest.json` — название «PROSTOR — клуб чистой воды», theme_color #1c4ed8, добавлены maskable icons
- [x] Smoke test PWA install — iOS Safari ✅ (8 мая 2026, капля с gradient на homescreen, тёмный фон от темы системы)
- [x] Commit в ветку `feature/water-pivot` + push на origin

**Реализация:** ветка `feature/water-pivot` в prostor-app (commit 8 мая 2026). PR создавать после полного завершения всех Phases или по этапу — на усмотрение разработчика.

**Что НЕ потребовалось делать вопреки изначальному плану:**
- Не правил `app/layout.tsx` (icons references работают через Next.js File Conventions автоматически после `app/icon.png` + `app/apple-icon.png`)
- Не делал отдельную ICO-версию (32×32 PNG в `app/icon.png` достаточно для всех современных браузеров)

**Acceptance:** PWA устанавливается с каплей-иконкой на homescreen, favicon в табе. ⏳ ожидает live PWA-тест в браузере разработчика.

### Phase 3 — Bottom-nav «Вода» (2-3 дня) — ✅ ЗАКРЫТ

- [x] Создать компонент `WaterDrop` в `shared/ui/icons/water-drop.tsx` — переиспользуемый brand-mark
  - 2 варианта: `outline` (currentColor stroke в стиле heroicons) и `filled` (gradient + sparkle)
  - Props: `size?` (px или 100% inherit), `animated`, `variant`, `className`
  - SSR-friendly (фиксированные defs id, без Math.random)
- [x] Расширить `widgets/footer` — добавлена 3-я вкладка «Вода» с `WaterDrop variant=outline`
- [x] Стиль outline-капли match heroicons: strokeWidth=3 на viewBox=48 (визуально = 1.5 на viewBox=24), strokeLinecap=round, strokeLinejoin=round
- [x] Анимация sparkle — точная копия CSS из оригинала Smart-Search mockup: `@keyframes wdspark` (opacity 0.7→1.0 + scale 0.95→1.05 + rotate 0→8°, 2.4s ease-in-out infinite). Selector `.waterdrop-anim .wd-spark` — opt-in через class
- [x] Route `/water` — заглушка `views/water-map/water-map-page.tsx` с hero-каплей, PageTitle «Карта качества воды · 15 504 анализа», skeleton-background и списком будущих фич
- [x] Light/Dark theme support — класс `.water-map-skeleton-bg` имеет варианты для `[data-theme='dark']`
- [x] Z-index не ломает burger-меню и footer — упрощённый layout без overflow-hidden / relative wrappers
- [x] Использован стандартный `PageTitle` из `shared/ui` для consistency с другими страницами prostor-app
- [x] Commit + push в `feature/water-pivot` (commit 6c56f04, 8 мая 2026)
- [ ] 3 viewport адаптация (iPad drawer / Desktop sidebar) — отложено в Phase 4 вместе с реальным maplibre
- [ ] E2E тест навигации — после Phase 4 (live карта)
- [ ] Подключение inline mock GeoJSON к maplibre — Phase 4 (требует maplibre setup в prostor-app)

**Что отличается от изначального плана:**
- ❌ FAB-стиль центральной кнопки **отвергнут разработчиком** — «не перегружать», обычная 3-я вкладка в стиле других иконок
- ❌ Sparkle на active state в nav — также убран по запросу разработчика «капля без sparkle, как корзина outline»
- ✅ Filled+sparkle оставлен только для hero/header страниц (где это brand-mark, не nav-icon)

**Acceptance:** клиент видит outline-каплю «Вода» в bottom-nav, тапает → попадает на placeholder-страницу с hero-каплей (filled gradient + sparkle) и описанием будущей фичи. Light/Dark theme работают. Burger-menu не блокируется. ✅

### Phase 4 — Backend ручки + flagship USP — ✅ ЗАКРЫТ (8 мая 2026)

**Pivot 8 мая 2026:** делаем **backend-first** — без real data фронт-дизайн уходит в воздух. Frontend production отложен в Phase 4.5 после закрытия 4.A. Прототип `prostor-heatmap-mobile-standalone.html` остаётся reference, точечно подгоним под реальные данные когда они будут.

**Итог:** все 6 endpoints Tier 1 (4.A) + 1 endpoint Tier 2 (4.B.6 aquifer-stats) закрыты за один день. 1101 unit-тест зелёные (64 test suites). 4 USP-фичи реализованы, 4 интеллектуальные доработки (severity-4 / per-problem search / reason / byCategory) добавлены поверх базы.

#### USP-фичи — что отличает PROSTOR от любого магазина фильтров

| # | Фича | Endpoint | Аудитория |
|---|---|---|---|
| **USP-1** | **Прогноз химии воды для нового адреса БЕЗ анализа** (kNN regression по 6-летнему архиву) | `/predict` | Конечные клиенты |
| **USP-2** | **Equipment-suggest по координатам** — рекомендация фильтра под адрес даже без анализа (вода→каталог cross-domain) | `/equipment-suggest` | Конечные клиенты + дилеры (как продающий аргумент) |
| **USP-3** | **Anomaly detection** — точки с локальным загрязнением (z-score>3 относительно соседей) | `/anomalies` | Дилеры, исследователи, демо для руководителя |
| **USP-4** | **Прогноз глубины скважины или колодца** для нового адреса (kNN на 7 884 точек well + 742 well_dug) | `/depth-predict` | **B2B №2: бурильщики, копатели колодцев, гидрогеологи, девелоперы** |

**Уникальность данных** (никто не имеет такого dataset на 8 мая 2026):
- 15 504 анализов воды частных адресов МО за 2020-2026 (97.6% c координатами)
- 21 параметр химии × geo × дата × лаборатория × источник × **глубина** × дилер
- Coverage `depth_meters`: well 76.7% (7 884), well_dug 41.2% (742) — **gold для drilling-domain**

**4 интеллектуальные доработки** (поверх базовых endpoints — отличают от наивных kNN-API):

1. **Interval-first responses** (PhD interval analysis, memory `feedback_interval_first_predictions`) — вместо точечного value `iron = 0.42` отдаём 3 уровня интервалов: `interval` P10-P90 80% (для решений) / `iqr` P25-P75 50% (типичный) / `hardRange` 100% (worst-case observed) + `pointEstimate`. Применимо ко всем predict-endpoints (predict + depth-predict).

2. **4-level pdkStatus** (severity gradation с median tipping point) — `safe / borderline / concerning / unsafe`. Не binary boolean — различает `borderline` (interval crosses ПДК + median ≤ pdk = «возможно норма») от `concerning` (median > pdk = «скорее всего проблема»). Без этого все 7 МО-параметров оказывались `borderline`, теряя приоритеты для UX.

3. **Per-problem catalog search** в /equipment-suggest — для каждой identified problem отдельный targeted vector query через `PROBLEM_TO_QUERY` mapping (paramCode → technology keywords: iron_total → «обезжелезиватель», hardness_total → «умягчитель ионный обмен»). Раньше один общий query → generic фильтры. Теперь — targeted RO-системы для nitrites unsafe, обезжелезиватели для iron concerning.

4. **byCategory pre-grouping** в /predict — 22 параметра pre-разбиты по 5 buckets `{ unsafe, concerning, borderline, safe, unmonitored }` с sort внутри (severity → pointEstimate desc, safe → alphabetically). UI shortcut для рендера секций без iteration по 22 параметрам.

#### 4.A Tier 1: фундамент карты + flagship USP — ✅ ЗАКРЫТО (8 мая 2026)

- [x] **4.A.1** `GET /water-analysis/heatmap` — commit `909d49e`. 22 canonical paramCodes + risk, polymorphic ПДК (single/range/none), GeoJSON, sub-100мс на МО, cache 24ч, 42 unit-теста
- [x] **4.A.2** `GET /water-analysis/predict` (USP-1) — commit `a730dbe` + `27ac3d0`. kNN + weighted IDW + recency. **Interval-first** (3 уровня P10-P90 / IQR / hardRange + pointEstimate). **4-level pdkStatus** (safe/borderline/concerning/unsafe — interval-aware с median tipping point). **`byCategory`** — pre-grouped 5 buckets для UI shortcut. 59 unit-тестов
- [x] **4.A.3** `GET /water-analysis/depth-map` (USP-4 base) — commit `2d31a3a`. Per-cell median/P25/P75 + **5 aquifer-buckets** + dominantLayerId + pctWell, single SQL с CASE-агрегацией. 39 unit-тестов
- [x] **4.A.4** `GET /water-analysis/depth-predict` (USP-4) — commit `a0b9a69`. **Interval-first 3 levels** (primary/iqr/hardRange) + pointEstimate + mostLikelyAquiferLayer. 33 unit-теста
- [x] **4.A.5** `GET /water-analysis/points` — commit `a0b9a69`. Individual анализы high-zoom + risk score + 22 параметра. Координаты обезличены 0.005°. ORDER BY sample_date DESC LIMIT N+1 (truncated флаг)
- [x] **4.A.6** `POST /water-analysis/equipment-suggest` (USP-2 flagship) — commit `985ef10` + `27ac3d0`. **Per-problem catalog search** (top-3 problems × PER_PROBLEM_K=2 targeted queries из PROBLEM_TO_QUERY mapping → dedup) + **matchedProblem + reason** в каждой recommendation. На smoke МО: 5 RO-систем для unsafe nitrites вместо generic корпусов. 51 unit-тест

**Реальные smoke результаты МО centre (55.756, 37.617):**
- /predict.byCategory: `{ unsafe: [nitrites], concerning: [color, turbidity, hardness, manganese], borderline: [4 params], safe: [5 params], unmonitored: [4 params] }`
- /equipment-suggest: 5 рекомендаций с reason «Решает явное превышение «Нитриты»» + «Решает вероятное превышение «Цветность»»

#### 4.B Tier 2: дополнительные insights (3-4 дня)

- [ ] **4.B.1** `GET /water-analysis/districts` — top-N худших районов по параметру + count + medians
- [ ] **4.B.2** `GET /water-analysis/anomalies?bbox=&param=` (USP-3) — z-score>3 точки
- [ ] **4.B.3** `GET /water-analysis/depth-history?district=&intakeType=` — изменение глубин 2020→2026 (climate-change angle)
- [ ] **4.B.4** `GET /water-analysis/quality-by-depth?bbox=&param=` — связь глубина↔качество для drilling-консультации
- [ ] **4.B.5** `GET /water-analysis/hotspots?param=&top=20` — топ точек с превышением ПДК (драматичные цифры)
- [x] **4.B.6** `GET /water-analysis/aquifer-stats?bbox=&intakeType=` (USP-4 deep-dive) — commit `27ac3d0` ✅
  - Per layer (5 buckets): count + pct + medianDepth + pctWell + **medianChemistry** (median 22 параметров)
  - Smoke МО (5000 точек, all): dominant `sandy_limestone` (41%), drilling signal — «бури глубже = чище вода». Верховодка nitrates 4.3 ⚠ → артезианский nitrates 0.8 ✓
  - GMM data-driven aquifer detection — отложено в backlog (fixed buckets из AQUIFER_LAYERS работают на МО гидрогеологии достаточно)

#### 4.C Tier 3: advanced/time (2-3 дня)

- [ ] **4.C.1** `GET /water-analysis/timeseries?district=&param=` — тренд по году (для time-lapse heatmap)
- [ ] **4.C.2** `GET /water-analysis/clusters?lat=&lon=` — HDBSCAN-кластеры по 21-D, тип воды для адреса
- [ ] **4.C.3** `GET /water-analysis/test-kit?lat=&lon=` — какие 5 параметров стоит реально мерить (эконом)
- [ ] **4.C.4** `GET /water-analysis/labs?bbox=` — распределение лабораторий
- [ ] **4.C.5** `GET /water-analysis/effectiveness?address=` — кейсы «до/после» установки оборудования (если найдём адреса с >1 анализом)

#### Каждый endpoint включает

- Prisma raw SQL (PostGIS / pgvector / window funcs где нужно)
- DTO + class-validator
- Throttle 60/min/IP (как `/water-analysis/similar`)
- Redis cache с TTL по типу (heatmap/depth-map 24ч, predict 5мин, hotspots 1ч)
- Unit + e2e тесты ≥10 кейсов на endpoint
- Swagger documentation
- PR + review-агенты (`prisma-pgvector-reviewer` обязательно)

**Acceptance Phase 4:** все Tier 1 endpoint'ы в проде, smoke через Swagger UI + Playwright. Каждая USP-фича верифицирована на ≥3 реальных адресах. После закрытия — переход в Phase 4.5 Frontend.

### Phase 4.5 — Frontend production (3-5 дней)

> Стартует после закрытия Phase 4.A Tier 1. Фронт пилится на **real data**, не на mock — это даёт верифицированный UX.

- [ ] Top-bar с layer-icon (по прототипу `prostor-heatmap-mobile-standalone.html`)
- [ ] Bottom-sheet с layer-toggles (default OFF):
  - [ ] Качество воды в районе (heatmap по 5 параметрам)
  - [ ] Похожие анализы рядом (radius circle от пина клиента)
  - [ ] **Глубина скважин и колодцев** (depth-map + bar chart горизонтов внизу карты + range-slider filter «показать только 30-100м» + popup с распределением по горизонтам)
  - [ ] **3D-режим скважин/колодцев** (extruded columns: высота = mean depth, цвет = aquifer layer — стретч-фича для wow-демо руководителю Аквафор)
  - [ ] Аномалии (anomaly markers)
  - [ ] Sub-filter intakeType: well / well_dug / both (для drilling-юзеров релевантен только нужный тип)
- [ ] Пин клиента + radius circle (geolocation + fallback на real-estate координаты)
- [ ] Click cell → popup с метриками + CTA «Подобрать оборудование» → equipment-suggest endpoint
- [ ] Onboarding overlay (FTUX) для первого запуска: 3-шаговый tour
- [ ] Dark theme map style (Voyager → Dark Matter по `[data-theme]`)
- [ ] 3D-tilt включён
- [ ] Responsive: mobile bottom-sheet / iPad slide-drawer / desktop sidebar
- [ ] TanStack Query для всех endpoint'ов с corresponding TTL

**Acceptance Phase 4.5:** на карте видны live-данные, клиент может toggle слои, видит свои координаты, получает USP-1/2/4 рекомендации в realtime.

### Phase 5 — Smart landing redirect (1 день)

- [ ] State-aware redirect в `(web)/page.tsx`
  - Юзер с real-estate + coordinates → `/water`
  - Без real-estate → `/catalog`
- [ ] Soft-launch: Phase 5 включается за feature-flag, default off
- [ ] A/B test через 2-4 недели — сравнить engagement / conversion
- [ ] Если map-first побеждает в A/B — включаем по умолчанию
- [ ] Если catalog-first побеждает — оставляем `/water` как 3-я вкладка nav

**Acceptance:** новые юзеры видят `/water` если есть real-estate, conversion не упала, engagement вырос.

### Phase 6 — Карточка «Мой анализ» (опционально, 3-4 дня)

> Связано с направлением 4 из status-update — может быть параллельно с Phase 4 или после.

- [ ] Frontend: bar/radar chart по 14 параметрам с цветами по % ПДК
- [ ] Сравнительная таблица «моё значение vs медиана соседей vs ПДК»
- [ ] Мини-карта похожих анализов (через `/water-analysis/similar`)
- [ ] CTA «Подобрать оборудование» → `/catalog`
- [ ] Маршрут `app/(web)/real-estate/[id]/water-analysis/[blankId]/page.tsx`
- [ ] Bridge с `/catalog/search` для рекомендаций

---

## Открытые вопросы (требуют решения)

1. **Empty state на `/water` для нелогиненного юзера** — обзор МО или CTA «Войди → увидишь свой район»?
2. **Где живут анализы конкретного клиента** — в CRM Аквафор? В slovo-архиве? Нужно проектное решение для Phase 6.
3. **Backend gateway** — prostor-app ходит в `slovo-api:3101` напрямую (CORS) или через `crm-back:3000` как proxy? Я голосую за **Next.js API routes как server-side proxy** — best UX + auth integration.
4. **Где документ живёт** — этот бриф в slovo (где идёт обсуждение), но при старте Phase 4.5 frontend нужно дублировать в `prostor-app/docs/features/water-pivot.md`.

**Решено:**
- Bottom-nav layout — обычная 3-я вкладка outline-капля (FAB-стиль отвергнут разработчиком в Phase 3, см. строку 158).
- Имя вкладки — «Вода» (Phase 3 closed).

---

## Метрики успеха

### Phase 2 (foundation)
- PWA install rate: до vs после капли — рост на 20%+ говорит о brand-impact
- Favicon recognition test (UX-ресёрч): 5/5 респондентов узнают капля = PROSTOR

### Phase 3-4 (карта)
- DAU на `/water` route — целевой минимум 30% от DAU всего приложения
- Среднее время на карте — целевой минимум 45 секунд (значит реально interest, не bounce)
- Click-through на «Подобрать оборудование» из popup — целевой 15%+

### Phase 5 (landing pivot)
- Conversion to purchase: новый landing vs старый — должен не упасть
- Time-to-first-tap: должен сократиться (карта быстрее цепляет чем 8 категорий)

---

## Что НЕ делаем (явные границы)

- ❌ **Не убираем каталог.** Каталог остаётся 1-й вкладкой bottom-nav, доступен в 1 тапе. Это conversion-step, не утилизируем его.
- ❌ **Не делаем код Phase 2-5 до approve руководителя.** Phase 1 (брифы / pitch) — single source of truth перед стартом разработки.
- ❌ **Не используем платные карты** (Mapbox / Google Maps). Только OSM CartoDB Voyager — open-source, без vendor lock-in, без платных ключей.
- ❌ **Не делаем native iOS/Android приложения сейчас.** PWA достаточно для MVP. Native — Phase X в отдельном плане.
- ❌ **Не показываем точные lat/lon на карте.** Координаты других клиентов уже округлены до 0.005° (~500м) на стороне slovo-api — k-anonymity ≥ 30 для МО. Не разкрываем приватность.

---

## Технические якоря

### Endpoints prostor-app будет использовать

| Endpoint (slovo-api) | Что | Готов? |
|---|---|---|
| `POST /catalog/search` | Vision search в каталоге | ✅ |
| `POST /water-analysis/similar` | Поиск похожих анализов с гео+сем фильтрами | ✅ |
| `GET /water-analysis/heatmap` | Агрегаты для тепловой карты (22 параметра + risk) | ✅ Phase 4 |
| `GET /water-analysis/predict` | kNN-прогноз 22 параметров + interval-first + 4-level pdkStatus + byCategory (USP-1) | ✅ Phase 4 |
| `GET /water-analysis/depth-map` | Карта глубин скважин/колодцев + 5 aquifer-buckets (USP-4) | ✅ Phase 4 |
| `GET /water-analysis/depth-predict` | Interval-first прогноз глубины бурения + mostLikelyAquiferLayer (USP-4) | ✅ Phase 4 |
| `GET /water-analysis/points` | Individual анализы high-zoom (PII roundCoord 0.005°) | ✅ Phase 4 |
| `POST /water-analysis/equipment-suggest` | Cross-domain рекомендация фильтра (USP-2 flagship) + per-problem search + reason | ✅ Phase 4 |
| `GET /water-analysis/aquifer-stats` | Стратифицированная chemistry per aquifer layer (USP-4 deep-dive) | ✅ Phase 4 |

### Стек prostor-app (без изменений)

- Next.js 16 (app router)
- maplibre-gl 5.20.1 (без новых deps для карты)
- TanStack Query 5.90 (для API state)
- daisyui 5.5 + Tailwind (UI)
- FSD architecture
- @tma.js/sdk-react 3.0 (Telegram mini-app, legacy)

### Где живёт код по Phase

| Phase | Файлы (prostor-app) |
|---|---|
| 2 (icons) | `public/favicon.ico`, `public/manifest.json`, `public/icons/*.png`, `app/layout.tsx` (meta) |
| 3 (nav) | `widgets/bottom-nav-water/`, `app/(web)/water/page.tsx`, `app/(web)/layout.tsx` |
| 4 (map) | `views/water-map/`, `features/water-heatmap/`, `entities/water-analysis/` |
| 5 (landing) | `app/(web)/page.tsx` (state-aware redirect logic) |
| 6 (карточка) | `views/water-analysis-card/`, `app/(web)/real-estate/[id]/water-analysis/[blankId]/` |

---

## Связь с другими документами

- [aquaphor-status-2026-05-07](../management/aquaphor-status-2026-05-07.md) — общий status для руководителя, направления развития 1-5
- [water-analysis](water-analysis.md) — backend часть архива анализов (Этапы 1.A → 1.B + Phase 2)
- [vision-catalog-search](vision-catalog-search.md) — backend часть catalog-search
- [vision-catalog-demo](../management/vision-catalog-demo.md) — 7 сценариев vision search

---

## Резюме

**Цель — превратить prostor-app в карту-помощника** через 4 модуля (капля → bottom-nav → карта → smart redirect). Phase 1 (согласование) **блокирующая** — без approve руководителя не начинаем код. После approve — Phase 2 (иконка) low-risk и foundation для всего остального. Phase 3-5 разворачиваем последовательно с soft-launch.
