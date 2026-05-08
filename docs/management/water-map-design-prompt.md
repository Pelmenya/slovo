# Промпт для claude design — Phase 4.5 Frontend production (Water Map)

> **Вариант A — все 7 endpoints + 4 USP-фичи + drilling-домен.** Maximum scope для полноценного demo руководителю Аквафор «клуб чистой воды + AI-помощник + B2B drilling».
> **Backend готов на 8 мая 2026** — 1101 unit-тест зелёные, все 7 endpoints в проде на http://localhost:3101.
> **Repo:** `prostor-app` (Next.js 16, FSD, ветка `feature/water-pivot`). Backend: `slovo-api` на 3101.

---

## Контекст

В **prostor-app** (репо https://github.com/lyapindm/prostor-app) уже есть:
- Phase 2: brand foundation — `WaterDrop` SVG icon component (`prostor-app/src/shared/ui/icons/water-drop.tsx`), PWA-иконки + manifest
- Phase 3: bottom-nav «Вода» (3-я вкладка с outline-каплей) + route `/water` с placeholder `views/water-map/water-map-page.tsx`

В **slovo** (этом репо) — backend водо-карты + 22 paramCode СанПиН справочник:
- 7 endpoints в `apps/api/src/modules/water-analysis/`
- Реализованы 4 USP-фичи: predict (USP-1) / equipment-suggest (USP-2 flagship) / depth-predict (USP-4 drilling) / aquifer-stats (USP-4 deep-dive)

**Задача Phase 4.5:** заменить placeholder в `views/water-map/` на полноценный production UI карты качества воды + всех 7 endpoint'ов.

---

## Концепция UI (из прототипа `slovo/prostor-heatmap-mobile-standalone.html`)

Прототип показывает **layer-system** для карты:

### Mobile (iPhone 14 Pro, 390×844)
- **Top-bar** компактный: back arrow + «Карта · Москва и МО» + layers icon
- **Карта на весь экран** с базовой подложкой (CartoDB Voyager light / Dark Matter dark)
- **Bottom-sheet** «Качество воды» (свернутый по умолчанию) с pill-toggle слоёв
- **Пин клиента** (синий) + опционально **radius circle** (зелёный dashed) от пина
- **FAB** «Похожие рядом» bottom-right

### iPad Pro 11" Portrait (820×1180)
- Side-drawer слева 320px вместо bottom-sheet (или slide-in)

### Desktop (1440×900)
- Full sidebar слева 360px с структурированными секциями (LAYERS / АНАЛИТИКА ПО РАЙОНУ)
- Карта на остальном пространстве

### Слои в bottom-sheet/sidebar (из desktop frame прототипа)

```
СЛОИ НА КАРТЕ
☑ Объекты (мои)              ← если auth, real-estate user'а
☑ Заказы                      ← Phase 6, опускаем сейчас
☑ Анализы воды                ← /points individual анализы
☑ Оборудование                ← Phase 6, опускаем

АНАЛИТИКА ПО РАЙОНУ
☐ Качество воды в районе    ← /heatmap (5 параметров pills внутри)
☐ Похожие анализы рядом     ← radius circle от пина клиента
☐ Глубина скважин и колодцев ← /depth-map (USP-4 drilling)
☐ Водоносные горизонты      ← /aquifer-stats deep-dive
```

**По умолчанию все aggregated layers OFF** (из прототипа: «Слой выкл...»). Юзер toggle'ит — чтобы не перегружать первый просмотр.

---

## Backend endpoints — все 7 + sample responses

### 1. `GET /water-analysis/heatmap` — тепловая карта параметров

**Query:** `?param=&west=&south=&east=&north=&grid=`
- `param` enum (22 canonical paramCodes из СанПиН + `risk` synthetic):
  `odor / color / turbidity / tds / hardness_total / permanganate_oxidizability / ph / ammonium / iron_total / manganese / magnesium / calcium / nitrates / nitrites / sulfates / sulfides / chlorides / fluorides / hydrogen_sulfide / alkalinity_total / temperature / electrical_conductivity / risk`
- `bbox` (west/south/east/north): WGS84
- `grid` 0.02-0.5° (default 0.05° ≈ 5.5km). PII: минимум 0.02° (~2.2km).

**Sample response** (МО centre, iron_total, grid=0.05):
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [37.475, 55.675] },
      "properties": {
        "param": "iron_total",
        "count": 12, "mean": 0.42, "median": 0.31, "p75": 0.65,
        "exceedsCount": 6, "exceedsPct": 50,
        "status": "mid"  // good/mid/bad — diverging color scale
      }
    }
  ],
  "param": "iron_total", "pdk": 0.3, "grid": 0.05,
  "timeTakenMs": 34, "cached": false
}
```

**UI:** maplibre `circle` layer с paint expression `interpolate ['linear'] ['get', 'median'] [pdk, green, 2*pdk, yellow, 3*pdk, red]`. Pills для switch 5 главных параметров (hardness_total / iron_total / manganese / tds / risk) — ярлыки, фронт может выставить 5 топовых из 23 доступных.

---

### 2. `GET /water-analysis/predict?lat=&lon=&k=20&radiusKm=50` (USP-1) ⭐

**Прогноз химии воды для нового адреса БЕЗ собственного анализа.**

**Sample response** (МО centre):
```json
{
  "predicted": {
    "iron_total": {
      "interval": { "lower": 0.005, "upper": 1.533, "confidence": 80 },   // P10..P90
      "iqr": { "lower": 0.005, "upper": 0.575, "confidence": 50 },         // P25..P75
      "hardRange": { "lower": 0.005, "upper": 5.8, "confidence": 100 },    // observed min..max
      "pointEstimate": 0.5499,                                              // weighted mean
      "n": 20,
      "pdkStatus": "concerning"  // 4-level: safe/borderline/concerning/unsafe/null
    },
    "ph": {
      "interval": { "lower": 6.48, "upper": 7.6, "confidence": 80 },
      "pdkStatus": "safe"
    },
    "temperature": { ..., "pdkStatus": null }  // не нормируется
  },
  "byCategory": {                       // UI shortcut для рендера секций
    "unsafe": ["nitrites"],
    "concerning": ["color", "turbidity", "manganese", "hardness_total"],
    "borderline": ["magnesium", "odor", "iron_total", "fluorides"],
    "safe": ["hydrogen_sulfide", "nitrates", "ph", "tds"],
    "unmonitored": ["temperature", "electrical_conductivity"]
  },
  "nNeighbors": 20,
  "medianDistKm": 1.1,
  "mostLikelyAquiferLayer": "50-100m / Песчано-известняковый",  // bonus drilling
  "insufficientData": false,
  "timeTakenMs": 47,
  "cached": false
}
```

**UI:** open popup/modal при клике на адрес или ввод `lat/lon`. Render **4 секции** через `byCategory` (без iteration по 22 params). Каждая секция — список параметров с **interval bar chart** (3 концентрических интервала + pointEstimate marker + ПДК-линия). Severity 4-level → 4 цвета:
- `unsafe` → red (oklch error)
- `concerning` → orange (между error и warning)
- `borderline` → yellow (oklch warning)
- `safe` → green (oklch success)
- `unmonitored` → grey

---

### 3. `GET /water-analysis/depth-map?bbox=&grid=&intakeType=` (USP-4 base)

**Карта глубин скважин/колодцев + 5 водоносных горизонтов.**

`intakeType`: `all` (default) | `well` | `well_dug`.

**Sample response** (per cell):
```json
{
  "type": "FeatureCollection",
  "features": [{
    "type": "Feature",
    "geometry": { "type": "Point", "coordinates": [37.625, 55.755] },
    "properties": {
      "count": 23, "median": 47.5, "p25": 32, "p75": 71,
      "minDepth": 12, "maxDepth": 145,
      "aquiferLayers": [
        { "id": "top_water", "label": "0-15m / Верховодка", "count": 1, "pct": 4 },
        { "id": "sandy", "label": "15-50m / Песчаный", "count": 8, "pct": 35 },
        { "id": "sandy_limestone", "label": "50-100m / Песчано-известняковый", "count": 12, "pct": 52 },
        { "id": "limestone", "label": "100-200m / Известняковый", "count": 2, "pct": 9 },
        { "id": "artesian", "label": "200m+ / Артезианский", "count": 0, "pct": 0 }
      ],
      "dominantLayerId": "sandy_limestone",
      "pctWell": 87
    }
  }],
  "intakeType": "all", "grid": 0.05
}
```

**UI:** maplibre layer (paint по `dominantLayerId` → 5 цветов горизонтов). **Wow-bonus:** опционально 3D extruded columns (`fill-extrusion`) где высота = `median` depth, цвет = layer. Drilling-юзеры будут в восторге.

---

### 4. `GET /water-analysis/depth-predict?lat=&lon=&intakeType=&k=20&radiusKm=50` (USP-4) ⭐

**Прогноз глубины бурения для нового адреса.**

**Sample response:**
```json
{
  "predicted": {
    "interval": { "lower": 28.9, "upper": 88.2, "confidence": 80 },     // P10-P90 для планирования
    "iqr": { "lower": 37.8, "upper": 72.5, "confidence": 50 },           // типичный диапазон
    "hardRange": { "lower": 10, "upper": 90, "confidence": 100 },        // worst-case observed
    "pointEstimate": 57.5,
    "n": 20
  },
  "mostLikelyAquiferLayer": "50-100m / Песчано-известняковый",
  "layerDistribution": [
    { "id": "top_water", "label": "0-15m / Верховодка", "count": 1, "pct": 5 },
    { "id": "sandy", "label": "15-50m / Песчаный", "count": 7, "pct": 35 },
    { "id": "sandy_limestone", "label": "50-100m / Песчано-известняковый", "count": 12, "pct": 60 },
    { "id": "limestone", "label": "100-200m / Известняковый", "count": 0, "pct": 0 },
    { "id": "artesian", "label": "200m+ / Артезианский", "count": 0, "pct": 0 }
  ],
  "nNeighbors": 20, "medianDistKm": 1.1, "intakeType": "well", "radiusKm": 50,
  "insufficientData": false, "cached": false
}
```

**UI:** popup/tab «Глубина бурения». **Vertical bar chart** с 3 концентрическими интервалами (hardRange grey → interval primary → iqr accent) + pointEstimate horizontal line + mostLikelyAquiferLayer highlighted в `layerDistribution` mini-chart. Это science-style визуализация для drilling-юзеров.

---

### 5. `GET /water-analysis/points?bbox=&limit=` — отдельные анализы high-zoom

**Sample response** (per point):
```json
{
  "type": "FeatureCollection",
  "features": [{
    "type": "Feature",
    "geometry": { "type": "Point", "coordinates": [37.275, 55.67] },  // обезличены до 0.005°
    "properties": {
      "orderNumber": "22618",
      "intakeType": "well",
      "depthMeters": 120,
      "sampleDate": "2026-04-29",
      "region": "Московская",
      "locality": null,
      "params": { "ph": 7.4, "tds": 386, "iron_total": 0.03, ... },
      "risk": 16
    }
  }],
  "count": 200, "truncated": true, "limit": 200
}
```

**UI:** maplibre `circle` pin layer когда zoom > 11. Click → popup с 22 параметрами (group через тот же `byCategory` подход что в /predict — UI helper). PII: координаты уже обезличены, не доразглашать.

---

### 6. `POST /water-analysis/equipment-suggest` (USP-2 flagship) ⭐

**Body:** `{"lat":55.756,"lon":37.617,"topK":5}`

**Sample response:**
```json
{
  "problems": [
    {
      "paramCode": "nitrites", "severity": "unsafe",
      "interval": { "lower": 4.3, "upper": 4.3 }, "pdk": 3, "n": 17
    },
    {
      "paramCode": "iron_total", "severity": "concerning",
      "interval": { "lower": 0.005, "upper": 1.533 }, "pdk": 0.3, "n": 20
    }
  ],
  "recommendations": [
    {
      "sku": "unknown", "name": "Водоочиститель Аквафор OSMO Pro-100-3-А-М",
      "relevance": 1, "description": "Колонна обратного осмоса для удаления нитритов...",
      "matchedProblem": "nitrites",
      "reason": "Решает явное превышение «Нитриты (NO2⁻)»",
      "imageUrl": "https://..."  // если есть
    }
  ],
  "searchQuery": "Подобрать оборудование для воды с проблемами: явное превышение «Нитриты»...",
  "nNeighbors": 20, "medianDistKm": 1.1,
  "insufficientData": false
}
```

**UI:** **modal/sheet** «Подбери фильтр». Top-section: список problems с severity-icon (red/orange/yellow). Bottom: cards рекомендаций товаров с **`reason` под названием** (UI «почему этот товар»: «Решает явное превышение нитритов»). CTA «В каталог» → `/catalog?related=nitrites` или `linkOut` на конкретный товар.

---

### 7. `GET /water-analysis/aquifer-stats?bbox=&intakeType=` (USP-4 deep-dive) ⭐

**Стратифицированная статистика по 5 водоносным горизонтам — типичная chemistry per layer.**

**Sample response:**
```json
{
  "layers": [
    {
      "id": "top_water", "label": "0-15m / Верховодка",
      "minDepth": 0, "maxDepth": 15,
      "count": 786, "pct": 16,
      "medianDepth": 8, "pctWell": 43,
      "medianChemistry": {
        "iron_total": 0.42, "hardness_total": 6.8, "nitrates": 4.3, "color": 22.25, ...
      }
    },
    {
      "id": "sandy_limestone", "label": "50-100m / Песчано-известняковый",
      "count": 2071, "pct": 41,
      "medianDepth": 63, "pctWell": 100,
      "medianChemistry": { "iron_total": 0.31, "hardness_total": 7.2, "nitrates": 1.9, ... }
    }
  ],
  "intakeType": "all", "totalWells": 5000, "samplesUsed": 5000,
  "dominantLayerId": "sandy_limestone"
}
```

**UI:** **bottom-sheet/sidebar tab** «Тип воды в районе». **Stacked bar chart** распределения по 5 горизонтам (% от total) + **table per layer** с типичной химией (показать топ-3 параметра: hardness, iron, nitrates). Drilling-signal: «бури глубже = чище вода» — подсветить trend-line в chart'е.

---

## UX-структура (полный layer-system)

### `views/water-map/` (новый — заменяет placeholder)

```
src/views/water-map/
├── ui/
│   ├── water-map-page.tsx          ← compose layout (mobile/iPad/desktop)
│   ├── water-map-canvas.tsx        ← maplibre wrapper, layer registry
│   ├── top-bar.tsx                 ← back + title + layers-icon (mobile)
│   ├── layer-panel.tsx             ← bottom-sheet/sidebar c toggle'ами
│   ├── layer-toggle-section.tsx    ← группа toggle'ов (LAYERS / АНАЛИТИКА)
│   ├── pin-marker.tsx              ← пин клиента + radius circle
│   ├── similar-fab.tsx             ← FAB с WaterDrop (filled animated)
│   ├── popup-cell-quality.tsx      ← popup при клике cell heatmap (params)
│   ├── popup-cell-depth.tsx        ← popup при клике cell depth-map (aquifer)
│   ├── popup-point.tsx             ← popup при клике individual point (22 params)
│   ├── modal-predict.tsx           ← modal с predict-results (4 byCategory секции)
│   ├── modal-equipment.tsx         ← modal с equipment-suggest (problems + cards)
│   ├── tab-aquifer-stats.tsx       ← tab/sheet с aquifer-stats (stacked + table)
│   ├── tab-depth-predict.tsx       ← tab/sheet с depth-predict (vertical bars)
│   ├── interval-bar-chart.tsx      ← reusable: 3 концентрических интервала + point + ПДК
│   ├── severity-badge.tsx          ← reusable: цвет + label по pdkStatus
│   └── onboarding-overlay.tsx      ← FTUX 3-step tour
├── lib/
│   ├── api.ts                      ← typed fetch wrappers для 7 endpoints (TanStack Query)
│   ├── color-scale.ts              ← maplibre paint expressions (heatmap по param + depth по layer)
│   ├── severity-colors.ts          ← mapping pdkStatus → daisyui semantic colors
│   ├── water-params.ts             ← UI labels + units для 22 paramCode (русские)
│   └── aquifer-layers.ts           ← UI labels для 5 горизонтов
├── model/
│   ├── use-water-map-store.ts      ← Zustand: selectedLayer, selectedParam, selectedCell, similarOn, intakeType
│   └── use-client-pin-store.ts     ← coords клиента (geolocation или real-estate)
└── index.ts
```

### `entities/water-analysis/` (новый)

```
entities/water-analysis/
├── model/
│   ├── t-heatmap-cell.ts           ← THeatmapCell + THeatmapStatus
│   ├── t-water-param.ts            ← TWaterParam + TParamId (22 enum)
│   ├── t-pdk-status.ts             ← TPdkStatus 4-level
│   ├── t-prediction.ts             ← TPredictResponse + TPredictParamEstimate + TParamInterval
│   ├── t-depth-cell.ts             ← TDepthCell + TAquiferLayerCount
│   ├── t-depth-prediction.ts       ← TDepthPrediction
│   ├── t-point.ts                  ← TPoint (individual анализ)
│   ├── t-equipment.ts              ← TWaterProblem + TEquipmentRecommendation
│   ├── t-aquifer-stats.ts          ← TAquiferLayerStats
│   └── t-similar-radius.ts         ← TSimilarRadiusKm union
└── index.ts
```

---

## Дизайн-принципы

### 1. **Severity 4-level color system** (interval-aware)
- `safe` → `success` (oklch green) ✓
- `borderline` → `warning` (oklch yellow) — выбросы выше, median ОК
- `concerning` → `oklch(70% 0.18 40)` (orange — между warning и error) — median выше ПДК
- `unsafe` → `error` (oklch red) ✗
- `unmonitored` → `neutral` (oklch grey) — нет норматива
- `null/loading` → `base-200`

Используй daisyui semantic tokens (`bg-success-content` / `bg-warning-content` / `bg-error-content`) для светлых вариантов фонов.

### 2. **Interval-first visualization** (PhD interval analysis обоснование)

Точная цифра «iron = 0.42 мг/л» обманывает (нондетерминированный процесс). UI должен **визуализировать interval, не точку**. Стандартный pattern:

```
hardRange (P0-P100, grey)        ├──────────────────────────────────┤
interval (P10-P90, primary)            ├────────────────────┤
iqr (P25-P75, accent darker)                  ├──────────┤
pointEstimate (median)                              │
ПДК (red dashed line)                  ┊
```

Bar chart горизонтальный (mobile) или vertical (depth-predict). Recharts/Chart.js или native CSS — на твой выбор.

### 3. **Per-problem reasoning в equipment-suggest**

Каждая product card показывает **`reason`** под названием — UI «почему этот товар»:
- «Решает явное превышение «Нитриты»» (unsafe)
- «Решает вероятное превышение «Железо»» (concerning)
- «Подходит для «Жёсткости» на границе ПДК» (borderline)

Иконка severity слева от названия (red/orange/yellow). Multiple matched problems → pill-tags.

### 4. **byCategory grouping в /predict popup**

22 параметра разнесены по 5 buckets — UI рендерит секции без iteration:
```
🔴 Срочные проблемы (1)
   Нитриты — interval [4.3, 4.3] мг/л, ПДК 3 ─ ✗ unsafe

🟠 Вероятные проблемы (4)
   Цветность — [4.59, 123.7] град, ПДК 20
   Марганец — [0.005, 0.932] мг/л, ПДК 0.1
   ...

🟡 На границе (4)
   Магний — [5, 55.5] мг/л, ПДК 50
   ...

🟢 В норме (5)
   pH, hardness, nitrates, hydrogen_sulfide, tds

⚪ Не нормируется (4)
   Температура, EC, ...
```

Collapse-секции, default раскрыты только проблемные.

### 5. **3D extruded columns (wow-фича для depth-map)**

Опционально — `fill-extrusion` layer на maplibre: высота столбика = `median` depth (scaled), цвет = `dominantLayerId` (5 aquifer цветов). Разработчик любит «visualization материализующая PhD-интервалы». Включается через toggle «3D» на mobile, по дефолту на desktop.

### 6. **Onboarding overlay (FTUX)**

Первый запуск `/water` (localStorage flag) — 3-step tour:
1. «Это карта качества воды соседей в МО» (show heatmap layer toggle)
2. «Кликни на район → детали + рекомендация фильтра» (highlight cell + simulate click)
3. «Бурильщикам — отдельный тоггл «Глубина скважин»» (show drilling layer)

---

## Стек prostor-app (без новых deps)

- Next.js 16 (app router)
- React 19
- maplibre-gl 5.20.1 (уже стоит)
- @tanstack/react-query 5.90 (для всех 7 endpoint'ов)
- daisyui 5.5 + Tailwind 4 (light/dark через `[data-theme]`)
- @heroicons/react v2 (outline)
- FSD architecture
- Zustand (для local state карты — selectedLayer/Param/Cell)
- Опционально: Recharts для interval-bar-charts (или native CSS)

---

## Файлы для read (источники правды)

| Путь | Что |
|---|---|
| `slovo/prostor-heatmap-mobile-standalone.html` | Pencil bundler с прототипом — **визуальный reference** (распакуй через Pencil tools) |
| `prostor-app/src/views/water-map/water-map-page.tsx` | Текущий placeholder — **полностью заменить** |
| `prostor-app/src/app/globals.css` | OKLCH theme tokens, `wdspark` анимация |
| `prostor-app/src/shared/ui/icons/water-drop.tsx` | `WaterDrop` brand-mark (`variant=filled`/`outline`, `animated`) — переиспользовать для FAB и hero |
| `prostor-app/src/shared/ui/bottom-sheet-modal/` | Готовый bottom-sheet — переиспользовать для popup'ов |
| `prostor-app/src/shared/ui/map-view/` | Базовый map-view (если есть maplibre setup — переиспользовать) |
| `prostor-app/src/widgets/footer/ui/footer.tsx` | Bottom-nav (3 вкладки) — **не трогать** |
| `prostor-app/src/entities/real-estate/` | Координаты клиента из real-estate (для пина + radius center) |
| `slovo/apps/api/src/modules/water-analysis/*/dto/*.response.dto.ts` | Точные TS shapes для всех 7 responses (можно скопировать types в prostor-app/entities/water-analysis) |
| `slovo/CLAUDE.md` | Code style + FSD conventions |

---

## Type conventions (CLAUDE.md slovo)

- Только `type`, не `interface`
- T-prefix на type aliases: `THeatmapCell`, `TPredictResponse`, `TPdkStatus`
- Файлы чистых типов: `t-<domain>.ts` (kebab)
- 4 пробела отступы
- `any` запрещён, `unknown` с narrow guards
- `as unknown as X` без обоснования — флаг
- ESLint enforced: `consistent-type-definitions: type`, `naming-convention: T-prefix`

---

## Что НЕ делать

- Не подключать платные карты (Mapbox, Google) — только OSM CartoDB
- Не добавлять новые npm-deps без необходимости (Recharts можно если нет CSS-альтернативы)
- Не трогать `widgets/footer/` (3-я вкладка «Вода» уже на месте, route `/water`)
- Не использовать `interface` (только `type`)
- Не использовать `any`
- Не использовать ASCII-art в коде
- Не добавлять эмодзи в код / комментарии (исключение — bootstrap логи, тут их нет)
- Не показывать точные lat/lon чужих анализов (координаты в `/points` уже обезличены до 0.005°)

---

## Acceptance Criteria

### MVP (Phase 4.5.1)
- [ ] Карта с heatmap-layer (5 параметров pills + risk) — работает на real `/heatmap`
- [ ] Click cell → popup с метриками + CTA «Подбери фильтр»
- [ ] Toggle «Похожие анализы рядом» → radius circle от пина клиента
- [ ] Modal `/predict` с 4 byCategory секциями + interval-bar-charts
- [ ] Modal `/equipment-suggest` с problems + product cards (`reason` под названием)
- [ ] Light + Dark theme работают (CartoDB Voyager / Dark Matter переключаются по `[data-theme]`)
- [ ] Mobile bottom-sheet / iPad drawer / Desktop sidebar — 3 viewport адаптация

### Drilling extras (Phase 4.5.2 — для wow-демо)
- [ ] Toggle «Глубина скважин и колодцев» → `/depth-map` heatmap
- [ ] 3D extruded columns по `medianDepth` (опц)
- [ ] Tab «Тип воды в районе» → `/aquifer-stats` (stacked bar + chemistry table)
- [ ] Tab «Бурение скважины» в predict-modal → `/depth-predict` (vertical interval-bars + layerDistribution)
- [ ] Filter intakeType (well/well_dug/all) для drilling-layers

### High-zoom детализация
- [ ] При zoom > 11 → `/points` layer с individual анализами
- [ ] Click pin → popup с 22 параметрами (та же byCategory группировка)
- [ ] Truncated badge «Увеличь zoom для детализации» если `truncated=true`

### Onboarding
- [ ] FTUX overlay (localStorage flag, 3-step tour)
- [ ] Auto-zoom на real-estate координаты клиента если есть (через `useClientPinStore`)

### Производительность
- [ ] TanStack Query кеширует — staleTime 5min для predict, 24h для heatmap/depth-map/aquifer-stats
- [ ] Maplibre `'use client'` через `next/dynamic` (SSR off)
- [ ] Layer toggle off → удаляется maplibre layer (не just hidden)

### Тесты
- [ ] Smoke `npm run dev` без console errors
- [ ] Burger-menu и footer-nav остаются работоспособны (z-index не сломан)
- [ ] iPhone Safari + Chrome Android — визуальный smoke

---

## Что вернуть

Все файлы — **прямо в живые папки** prostor-app по структуре выше. После выполнения:

1. Список созданных/изменённых файлов с относительными путями
2. Какие endpoints из 7 покрыты MVP, какие drilling-extras, какие пропущены и почему
3. Любые открытые вопросы (например design decisions которые не очевидны)
4. Команда для smoke: `cd prostor-app && npm run dev` → `http://localhost:3050/water`

Backend на http://localhost:3101 (CORS уже настроен в slovo-api). Если CORS issues — добавь prostor-app origin в `parseCorsOrigin` env-var.

---

## Связанная документация

- `slovo/docs/features/prostor-water-pivot.md` — общий бриф фичи (Phase 1-6)
- `slovo/docs/features/water-analysis.md` — backend архив анализов
- `slovo/CLAUDE.md` — code conventions для всего стека
- `slovo/PROSTOR-Smart-Search.html` — оригинальный дизайн-mockup от первого раунда (для inspirations)
- Memory `feedback_interval_first_predictions` — обоснование 4-level severity
- Memory `feedback_water_heatmap_pii_strategy` — обоснование 0.02° grid + 0.005° roundCoord
- Memory `project_water_drilling_b2b_segment` — drilling-аудитория

---

**Это полный handoff для большой работы (~7-10 дней).** Можно делать поэтапно — сначала MVP, потом drilling extras, потом high-zoom + onboarding. Главное — поддерживать живой код в `feature/water-pivot` ветке prostor-app, не накапливать слепых артефактов.
