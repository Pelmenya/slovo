# Промпт для claude design — порт водо-heatmap в prostor-app

> Этот документ — ТЗ для дизайн-агента в чате claude.ai (Pencil-enabled), у которого подключены живые папки `slovo` и `prostor-app`. Передай промпт целиком, агент сам читает файлы по путям.

---

## Контекст

В `prostor-app` есть placeholder-страница `/water` (создана в Phase 3 фичи water-pivot — см. `slovo/docs/features/prostor-water-pivot.md`). Сейчас там hero-секция с `WaterDrop` и skeleton-блок «Скоро здесь».

Задача: **заменить skeleton-блок на полноценную интерактивную карту качества воды** на базе готового мобильного прототипа `slovo/prostor-heatmap-mobile-standalone.html` (Pencil bundler — расшифруй через свои Pencil tools для визуального reference). Hero-header не трогаем — он уже верифицирован разработчиком на light/dark.

Бэкенд `GET /water-analysis/heatmap` ещё не готов — на этом этапе работаем на **inline mock GeoJSON** (~50-80 cells по Москве и МО, 5 параметров). Структуру mock'а вынеси в отдельный файл, чтобы потом легко заменить на live fetch.

---

## Стек prostor-app (не менять, не добавлять deps без необходимости)

- Next.js 16 (App Router)
- React 19
- TypeScript strict
- maplibre-gl 5.20.1 (уже стоит)
- @tanstack/react-query 5.90 (для будущего live fetch)
- daisyui 5.5 + Tailwind 4 (light/dark через `data-theme` attribute)
- @heroicons/react v2 (outline по умолчанию)
- FSD (entities/features/widgets/views/shared)

Type-conventions из CLAUDE.md (см. `slovo/CLAUDE.md` секция «Стиль кода»):

- Только `type`, не `interface`
- Префикс `T` для всех типов: `TWaterParam`, `THeatmapCell`
- Файлы чистых типов: `t-<domain>.ts` (kebab-case)
- 4 пробела отступы
- `any` запрещён, `as unknown as X` без обоснования — флаг

---

## Файлы которые читать (источники правды)

| Путь | Что | Как использовать |
|---|---|---|
| `slovo/prostor-heatmap-mobile-standalone.html` | Pencil bundler с прототипом | Распаковать через Pencil tools, взять как **визуальный reference** (цвета, layout, pills, popup, FAB). Точно копировать UX, не структуру кода. |
| `prostor-app/src/views/water-map/water-map-page.tsx` | Текущий placeholder | **Hero-header сохранить** (оставить как есть). Заменить только секцию с `water-map-skeleton-bg` на live карту. |
| `prostor-app/src/app/globals.css` | Theme tokens, OKLCH цвета, `wdspark` анимация, `water-map-skeleton-bg` (можно удалить после) | Использовать существующие OKLCH токены + daisyui цвета (`bg-base-100`, `text-base-content` и т.д.). НЕ хардкодить hex — только daisyui semantic colors. |
| `prostor-app/src/shared/ui/icons/water-drop.tsx` | Brand-mark капля | Использовать `<WaterDrop variant="filled" animated />` для FAB на карте (44-56px). Outline-вариант — только в footer-nav, не на карте. |
| `prostor-app/src/shared/ui/map-view/` | Существующий map-view компонент | **Прочитать обязательно**. Если уже инкапсулирует maplibre-gl setup — переиспользовать или расширить. Не плодить второй maplibre wrapper. |
| `prostor-app/src/shared/ui/page-title/` | `PageTitle` компонент | Используется в hero-header water-map-page (уже есть) |
| `prostor-app/src/shared/ui/bottom-sheet-modal/` | Готовый bottom-sheet | Использовать для popup на mobile при click cell, не писать свой |
| `prostor-app/src/widgets/footer/ui/footer.tsx` | Bottom-nav (3 вкладки: Каталог / Вода / Корзина) | Не трогаем — карта рендерится **выше** footer'а |
| `prostor-app/src/entities/real-estate/` | Адреса клиента с координатами | Использовать координаты из `useRealEstateStore` (или аналог) для **auto-zoom** на адрес юзера если есть. Если нет — fallback на МО bbox. |

---

## Что построить (структура файлов)

Соблюдать FSD-границы. Не валить всё в один файл.

```
prostor-app/src/
├── views/water-map/
│   ├── ui/
│   │   ├── water-map-page.tsx          # уже есть, доработать (заменить skeleton секцию)
│   │   ├── water-map-canvas.tsx        # client-component с maplibre-gl, инициализация карты
│   │   ├── water-map-pills.tsx         # горизонтальный selector параметра (Жёсткость / Железо / ...)
│   │   ├── water-map-onboarding.tsx    # 3-шаговый FTUX overlay для первого запуска
│   │   ├── water-map-cell-popup.tsx    # popup при click cell (через bottom-sheet-modal на mobile)
│   │   └── water-map-similar-fab.tsx   # FAB с WaterDrop для toggle «похожие в радиусе»
│   ├── lib/
│   │   ├── mock-heatmap.ts             # inline mock GeoJSON FeatureCollection (50-80 cells)
│   │   ├── water-params.ts             # справочник 5 параметров (id, label, unit, ПДК, цвета по diverging scale)
│   │   └── use-heatmap-data.ts         # React hook: пока возвращает mock, готов под TanStack Query
│   ├── model/
│   │   └── water-map.store.ts          # Zustand или local state — selected param, similar toggle, radius
│   ├── water-map-page.tsx              # уже есть, точка входа
│   └── index.ts                        # public API
├── entities/water-analysis/
│   ├── model/
│   │   ├── t-heatmap-cell.ts           # тип cell (lat/lon/grid/value/percentExceedsPdk)
│   │   ├── t-water-param.ts            # тип параметра
│   │   └── t-similar-analysis.ts       # тип похожего анализа (для radius-toggle)
│   └── index.ts
└── features/water-heatmap/             # опционально, если выделится — features-уровень
    ├── ui/
    │   └── ...
    └── index.ts
```

**Граница views/features:** если фича «similar в радиусе» получится самодостаточной — выноси в `features/water-similar-radius/`. Если просто toggle на карте — оставь внутри `views/water-map/`.

---

## Acceptance Criteria

### Карта (maplibre-gl)

- Базовая подложка: **OSM CartoDB Voyager** (light) / **CartoDB Dark Matter** (dark) — переключение по `[data-theme]` attribute (через `theme` prop в style URL)
- Heatmap layer на mock GeoJSON с diverging-цветовой шкалой (зелёный = норма, жёлтый = на границе ПДК, красный = превышение)
- 3D-tilt включён (бонусная maplibre-фича): `pitchWithRotate: true`, `dragRotate: true`, max pitch 60°
- Initial view: bbox Москвы и МО (lat 55.0-56.5, lon 36.5-38.5), zoom 8.5
- Auto-zoom на координаты юзера из `entities/real-estate` если есть (animated `flyTo`)
- Maplibre attribution в углу (обязательно по лицензии OSM)

### Pills параметра (horizontal scrollable)

- 5 пунктов: **Жёсткость** / **Железо** / **Марганец** / **TDS** / **Risk-score**
- Active state: `bg-primary text-primary-content` (daisyui)
- Inactive: `bg-base-200 text-base-content` с `border-base-content/20`
- Toggle меняет heatmap layer source/property
- На mobile — sticky над bottom-nav, scroll-snap по pills
- На desktop (lg+) — slim sidebar слева 320px

### Click cell → popup

- Mobile: `bottom-sheet-modal` (используя готовый компонент)
- Desktop: floating popover у клика
- Содержание:
  - Название района / координаты cell (округлённо)
  - Текущее значение выбранного параметра + единица + статус (норма/граница/превышение)
  - Микро-сравнение с ПДК (color-coded прогресс-бар)
  - Сколько анализов в этой ячейке (`count`)
  - CTA-кнопка «Подобрать оборудование» → `/catalog?related=<param>`

### FAB «Похожие анализы рядом»

- Position: bottom-right, **выше footer-nav** (отступ ~80px от низа viewport)
- 56×56 px круг, gradient OKLCH (тот же что в `WaterDrop variant="filled"`)
- Использовать `<WaterDrop variant="filled" animated />` 32-36px внутри
- Toggle активирует pin клиента (синий) + radius circle (зелёный outline) на карте
- При активном — над FAB всплывает radius-pills (5/10/25/50 км)

### Onboarding overlay (FTUX)

- Показывается ОДИН раз (localStorage flag `water-map-ftux-seen`)
- 3 шага: «Тут карта качества воды соседей» → «Кликни на район — увидишь детали» → «Подберём фильтр под твой адрес»
- Возможность skip
- Каждый шаг — semi-transparent overlay с подсветкой нужного UI-элемента (карта / pill / FAB)

### Light / Dark theme

- ВСЁ должно работать в обеих темах (test через `<html data-theme="dark">`)
- Maplibre style URL переключать (Voyager / Dark Matter)
- Цвета heatmap diverging scale — корректировать opacity для dark theme (на тёмной подложке red/yellow читается хуже)
- Pills + popup + FAB — через daisyui semantic colors, не hex

### Viewports

- **Mobile** (< 768px): full-screen карта, pills sticky над footer-nav (`bottom: 64px`), bottom-sheet popup
- **Tablet** (768-1199px): то же что mobile + 3D-tilt чувствительнее (drag rotate)
- **Desktop** (1200+): slim sidebar слева 320px с pills вертикально, popup floating у клика, FAB на тех же координатах

### Производительность

- mock-heatmap.ts — статический import (Tree-shake friendly), не runtime fetch
- maplibre-gl — dynamic import с SSR off (компонент `'use client'` + `next/dynamic` где нужно)
- Cells render как `circle` layer с radius scaling по zoom (не как полигоны на старте — performance proof)

---

## Что НЕ делать

- Не подключать платные карты (Mapbox, Google Maps)
- Не добавлять новые npm-зависимости — всё на текущем stack
- Не писать тесты на этом этапе — добавим в integration-фазе
- Не трогать `widgets/footer/` (3-я вкладка «Вода» уже на месте)
- Не трогать hero-header `water-map-page.tsx` (уже верифицирован)
- Не использовать ASCII-art в комментариях / документации
- Не добавлять эмодзи в код / комментарии (исключение — bootstrap-логи, тут их нет)
- Не использовать `interface` (только `type`), не использовать `any`

---

## Output (что вернуть)

Все новые файлы — **прямо в живые папки** prostor-app по структуре выше. Файл `slovo/prostor-heatmap-mobile-standalone.html` не трогать (он reference-only).

После того как все файлы созданы — короткий summary в чат:

1. Список созданных/изменённых файлов с относительными путями
2. Какие mock-данные использованы (диапазон координат, кол-во cells, какие параметры)
3. Какие открытые вопросы / решения остались на разработчика
4. Команда для smoke-теста: `cd prostor-app && npm run dev` → `http://localhost:3000/water`

---

## Связанная документация (если нужен дополнительный контекст)

- `slovo/docs/features/prostor-water-pivot.md` — общий бриф фичи (Phase 1-6)
- `slovo/docs/features/water-analysis.md` — backend архив анализов (источник данных в Phase 4)
- `slovo/CLAUDE.md` — code style + FSD conventions для всего стека

---

**Финальная проверка перед коммитом** (это сделает разработчик после получения output'а):

- [ ] `npm run dev` стартует без ошибок
- [ ] `/water` рендерится в light / dark theme
- [ ] Pills переключают heatmap-layer
- [ ] Click cell открывает popup
- [ ] FAB toggle включает radius circle
- [ ] Onboarding показывается на первый запуск
- [ ] Burger-menu и footer-nav остаются работоспособны (z-index не сломан)
- [ ] iPhone Safari + Chrome Android — визуальный smoke
