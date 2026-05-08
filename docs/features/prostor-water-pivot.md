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
- ❌ slovo-api endpoint `/water-analysis/heatmap` — **не реализован** (нужен ~3 дня для Phase C)

---

## Phases с чек-боксами прогресса

### Phase 1 — Согласование с руководителем Аквафор (БЛОКИРУЮЩАЯ)

- [ ] Подготовить материал для встречи: страницу «Product pivot» в `aquaphor-status-2026-05-07.md` или отдельный mini-pitch
- [ ] Встреча с руководителем — обсудить map-first positioning
- [ ] Получить решение: `[ ] Approve` / `[ ] Reject` / `[ ] Modify`
- [ ] Если modify — зафиксировать поправки и обновить этот документ
- [ ] Договориться по timeline: когда демо, когда production-deploy

**Критерий перехода к Phase 2:** approve по product-positioning от руководителя.

### Phase 2 — Brand foundation (1-2 дня, low-risk)

- [ ] Извлечь SVG капли из `PROSTOR-Smart-Search.html` (Pencil bundler-ассеты в base64)
- [ ] Если SVG не извлечь — нарисовать заново по образцу скриншота
- [ ] Создать 3 цветовых варианта (OKLCH gradient)
- [ ] Сгенерировать PWA-иконки 192/512/180/152/120 px из SVG-источника
- [ ] Создать Maskable иконку для Android (с safe-zone)
- [ ] Заменить `prostor-app/public/favicon.ico` на каплю
- [ ] Обновить `prostor-app/public/manifest.json` — новые иконки
- [ ] Обновить `<meta>` Apple Touch icon в `app/layout.tsx`
- [ ] Smoke test PWA install на Android Chrome + iOS Safari
- [ ] Commit + deploy на staging

**Acceptance:** PWA устанавливается с каплей-иконкой на homescreen, favicon в табе.

### Phase 3 — Bottom-nav «Вода» (2-3 дня)

- [ ] Создать компонент `widgets/bottom-nav-water/` (или расширить существующий footer)
- [ ] FAB-style центральная кнопка — капля 56×56 px с gradient + sparkle
- [ ] States: idle (gradient) / active (outline + filled label) / pressed (scale 0.95)
- [ ] Sparkle анимация на mount (subtle, opacity 0.5 → 1.0 за 800мс)
- [ ] Route `/water` — заглушка с прототипом heatmap (порт `prostor-heatmap-mobile-standalone.html`)
- [ ] Подключить inline mock GeoJSON к maplibre (без бэка пока)
- [ ] 3 viewport адаптация: bottom-sheet (mobile) / drawer (iPad) / sidebar (desktop)
- [ ] Touch target FAB ≥ 56×56 (Apple HIG +12 для primary)
- [ ] E2E тест Cypress / Playwright: tap FAB → /water route
- [ ] Commit + staging

**Acceptance:** клиент видит каплю в bottom-nav, тапает → попадает на карту с прототипным heatmap'ом.

### Phase 4 — Heatmap production (3-4 дня)

#### Backend (slovo-api)

- [ ] Endpoint `GET /water-analysis/heatmap?param=...&bbox=...&grid=0.05`
- [ ] Prisma raw SQL: `ST_SnapToGrid(geo_point, $grid)` → `AVG(params->>$param)` + `pct_exceeds_pdk`
- [ ] DTO + class-validator для query params
- [ ] Response: GeoJSON FeatureCollection с агрегированными cells
- [ ] Кэш в Redis (TTL 24 ч — данные меняются медленно)
- [ ] Throttle 60/min/IP (как `/water-analysis/similar`)
- [ ] Unit + e2e тесты (≥10 кейсов)
- [ ] Документация в Swagger
- [ ] PR + review-агенты

#### Frontend (prostor-app)

- [ ] Заменить inline mock GeoJSON на live fetch к `/water-analysis/heatmap`
- [ ] TanStack Query для caching + optimistic updates на параметр-toggle
- [ ] Error states: 503 (бэк down) / empty (нет данных в bbox) / loading (skeleton)
- [ ] Pills параметра — горизонтальный scroll snap на mobile
- [ ] Click cell → popup с метриками + CTA «Подобрать оборудование» → `/catalog?related=<param>`
- [ ] Onboarding overlay (FTUX) для первого запуска: 3-шаговый tour
- [ ] Auto-zoom на real-estate координаты клиента если есть (через `entities/real-estate`)

**Acceptance:** на карте видны heatmap по реальным данным slovo-архива, клиент может переключать параметры и видит мотивирующие метрики.

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

1. **Bottom-nav layout** — FAB-style по центру (как описал в Phase 3) или обычная 3-я вкладка? FAB premium-feel но сложнее реализовать.
2. **Имя вкладки** — «Вода» (согласовано в обсуждении 8 мая) ✅
3. **Empty state на `/water` для нелогиненного юзера** — обзор МО или CTA «Войди → увидишь свой район»?
4. **Где живут анализы конкретного клиента** — в CRM Аквафор? В slovo-архиве? Нужно проектное решение для Phase 6.
5. **Backend gateway** — prostor-app ходит в `slovo-api:3101` напрямую (CORS) или через `crm-back:3000` как proxy? Я голосую за **Next.js API routes как server-side proxy** — best UX + auth integration.
6. **Где документ живёт** — этот бриф в slovo (где идёт обсуждение), но при старте Phase 2 нужно дублировать в `prostor-app/docs/features/water-pivot.md`.

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
| `GET /water-analysis/heatmap` | Агрегаты для тепловой карты | ❌ Phase 4 |

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
