# Smart Search Integration — план фичи

> **Статус:** план готов, реализация **не начата**. Phase 1 backend delta — мне (slovo-claude). Phase 1 frontend — prostor-claude.
>
> **Дата:** 2026-05-15
>
> **Источник:** дизайн-prototype от claude.ai design `prostor-app/PROSTOR Smart Search.html` (6 sections: Hero / До-После / Бренд-маркер / Точка интеграции в карту / Mobile 3 состояния / Alt-режимы + Desktop widescreen + Handoff). Открывается через `localhost:3050/prostor-smart-search-review.html` (скопирован в prostor-app/public).

---

## Цель

Интегрировать **multi-modal smart search** (текст + фото + голос) в верх PROSTOR `/water` страницы — One-tap entry-point поверх карты. AI разбирает intent юзера и подбирает **товар + услугу + расходник** одним listing'ом.

Заменяет три фрагментированных entry-point'а текущего UX:
- Адрес-based прогноз (`equipment-suggest` по lat/lon)
- Ручной catalog-поиск (по точным артикулам)
- FTUX-подсказка для нового юзера

В единый **«Сфоткай — найдём»** flow с **«капля + sparkle»** как фирменным AI-маркером.

---

## Background — что уже есть

### Backend (slovo)

**`POST /catalog/search`** — vision-catalog-search Phase 1+2 закрыт (2 мая 2026, см. `vision-catalog-search.md`):

Текущий contract:
```jsonc
{
    "query": "string",        // text query, optional
    "topK": 5,                // optional, default 5
    "imageBase64": "string"   // optional, до 5 фото в одном request
}
```

Возвращает:
```jsonc
{
    "count": number,
    "docs": [{
        "id": "chunk-id",
        "pageContent": "...",
        "metadata": {
            "externalId": "moysklad-uuid",   // primary identifier
            "name": "Аквафор DWM-101S",
            "salePriceKopecks": 4990000,
            "categoryPath": "...",
            "externalType": "product",
            "externalSource": "moysklad"
        },
        "imageUrls": ["presigned-minio-url"]   // TTL 1ч, через StorageService
    }],
    "timeTakenMs": number
}
```

**Pre-launch hardening** уже сделан (per-IP throttle 10/min, image cache SHA256, budget cap + Telegram alert).

**Vision augmentation** на ingest — 155 товаров обработаны Haiku 4.5 (vision-аугментер натуральные описания «фильтр обратного осмоса под мойку, четыре прозрачные колбы, белый корпус» — это и есть **то что catalog vector search матчит** по semantic similarity вместо точных артикулов).

### Frontend (prostor-app)

- `views/water-map-page.tsx` — главный entry для `/water`
- `BottomSheetModal` pattern — 8 modal'ов унаследовали (backdrop-blur, drag handle, footer prop, iOS scroll-lock)
- `EquipmentModal` v5 — recommendation-card structure с image + name + matchedProblem badge + reason + цена ₽ + split actions «Подробнее»/«В корзину» (commit `dbf8589` 2026-05-15)
- `SeverityBadge` / `AutoEquipmentCard` / `RealEstatePicker` — переиспользуемые компоненты

### Design system inherited (closed)

Все decisions из 2026-05-14 review закрыты в коде:
- OKLCH palette (severity 4-level + aquifer 5-level theme-aware)
- Glass-style FAB (`bg-base-100/95 backdrop-blur`)
- BottomSheetModal pattern (drag + swipe-down + footer slot)
- Pin-animation + cold-load splash + 44px touch-targets

---

## State of art (prototype от claude design)

Основные decisions из prototype (которые **берём as-is**):

### Branding — «капля + sparkle»

Single AI-маркер на весь функционал. **OKLCH gradient:**

```css
.ai-search-drop {
    fill: linear-gradient(180deg,
        oklch(72% 0.16 232),
        oklch(58% 0.22 250),
        oklch(48% 0.26 270)
    );
    /* sparkle = маленькая белая 4-конечная звезда в правом-верхнем углу drop */
}
```

**6 living contexts:**
1. FAB на карте — 56×56 round halo-pulse, справа-снизу
2. Sticky inline — в шапке Smart Search input (20px)
3. Header glyph — 26px
4. Empty state — 40px
5. Splash onboarding — 72×72 gradient на тёмном
6. Inline badge — 16px

### 3 mobile состояния (idle / loading / results)

| State | Содержание |
|---|---|
| **Idle** | Header «Умный поиск» + WaterDropAI 26px + AI-badge<br>Search input «например: фильтр под мойку как у мамы»<br>4 chip-suggestions: `📷 Фото товара` / `📰 По артикулу` / `💧 Проблема с водой` / `⚙ Установка / монтаж`<br>«Найдём оборудование за 1 секунду» — explainer<br>**«Недавние поиски»** — last 3 queries (Zustand persist) |
| **Loading** | Search query echo «фильтр как на фото»<br>**3-stage AI pipeline visible** (no black-box spinner):<br>`📷 Фото 2.4MB` → `👁 Vision (zrit 23ms)` → `🔒 pgvector`<br>Tags из Vision detection: `белый корпус` `4 колбы` `Аквафор`<br>«● подбираем товары обычно ~1.4 секунды» |
| **Results** | AI badge «AI РАСПОЗНАЛ — 4 объекта»<br>**Bbox image overlay** — photo юзера с annotated bounding boxes<br>Vision label «обратный осмос · Аквафор»<br>Confidence indicator «high · 0.91»<br>«Подходящие товары · 3 из 12»<br>Product cards (reuse `EquipmentRecommendationCard`):<br>image + name + matchedProblem badge + reason + цена + **bundled service** «Монтаж под мойку 2 500 ₽» |

### Desktop split-pane

- **Left 280px:** AI vision preview (image + label + confidence) + filter chips (Тип / Производитель / Цена)
- **Right grid:** «12 систем · подобрано под фото» — 2×4 product cards с relevance scores (91% / 84% / 72%)

### Alt-режимы (Phase 2 stretch)

- **Voice listening** — animated blue button + waveform + transcription inline до `onend`
- **Follow-up dialogue** — user bubble «а подешевле без монтажа?» → AI переподобрал «магистральные»
- **FTUX coach tooltip** при первом «Сфоткай — найдём» открытии

---

## Phases roadmap

### Phase 1 — Baseline (этот sprint)

**Цель:** minimum viable smart-search в `/water` page. Text + photo, single-shot, mobile-first.

**Backend (slovo, мне):**

`POST /catalog/search` response **shape extension** (additive, не breaking):

```diff
{
    "docs": [{
        // existing:
        "id": "...",
        "pageContent": "...",
        "metadata": { "externalId", "name", "salePriceKopecks", "categoryPath", ... },
        "imageUrls": ["presigned"],
+       // новое (Phase 1):
+       "matchScore": 91,   // 0..100, vector similarity score scaled
    }],
+   "vision": {
+       "category": "обратный осмос",
+       "description": "Компактная система обратного осмоса под мойку, белый корпус, 4 колбы",
+       "confidence": "high" | "mid" | "low"
+   } | null   // null если image не передан
}
```

**Где брать:**
- `matchScore` — Flowise `metadata.score` (раньше я fallback'ил на 1.0; теперь exposed как 0..100 scale)
- `vision: {...}` — НОВОЕ. Извлекаем из vision-describer output (vision-catalog-search Phase 1 уже использует Haiku 4.5 для Vision на ingest; нужно адаптировать для **runtime** Vision на user-submitted image)
- `vision.confidence` — discrete bucket из numeric confidence score (`>= 0.8` → high, `0.5-0.8` → mid, `< 0.5` → low)

**Acceptance:**
- [ ] Existing `/catalog/search` тесты проходят без изменений (additive shape)
- [ ] При image передан → `vision: {...}` в response, при нет — `null`
- [ ] `matchScore` 0..100 в каждом doc
- [ ] Кэш Redis version bump (vision-catalog `vc-v1` → `vc-v2` или аналог)
- [ ] Unit-тесты для confidence-bucketing function (low/mid/high boundaries)
- [ ] Live curl smoke с реальным photo Аквафор-фильтра → vision.category совпадает с категорией в каталоге

**Frontend (prostor-claude):**

Новый `prostor-app/src/features/smart-search/`:

| Component | Responsibility |
|---|---|
| `SmartSearchInput.tsx` | Sticky input под top-bar в water-map-page. Text + camera-icon. Click camera → upload photo. Submit on Enter. Replaces текущий FTUX hint card |
| `SmartSearchFab.tsx` | Camera FAB right-bottom с halo-pulse (опционально для onboarding NEW badge) |
| `SmartSearchOverlay.tsx` | BottomSheetModal с 3 states (idle/loading/results). Reuse существующего `BottomSheetModal` pattern |
| `WaterDropAI.tsx` | SVG branding component (gradient OKLCH 232°→250°→270°, sparkle поверх). Размеры 16/20/26/40/56/72px |
| `RecentSearchesList.tsx` | History last 3 queries из Zustand persist |
| `useSmartSearchStore.ts` | Zustand state: query / image / results / vision / status (idle/loading/done/error) / recentQueries[] |
| `useSmartSearch.ts` | TanStack Query mutation для `POST /catalog/search` |

**Acceptance:**
- [ ] Idle state — input + 4 chip-suggestions + recent searches
- [ ] Loading state — 3-stage progress visible (image upload → vision → vector search). Не requires real progress events; can be **simulated** stage-by-stage с timers если backend не streams
- [ ] Results state — AI vision badge + product cards (reuse `EquipmentRecommendationCard` shape)
- [ ] Mobile 390 + Desktop 1280
- [ ] Search-on-submit (Enter/button), не on-typing — throttle-safe
- [ ] Brand: WaterDropAI везде, glass-style sticky input
- [ ] Replaces FTUX hint card в `water-map-page.tsx`

### Phase 1.5 — Premium UX (опционально, после Phase 1 deploy)

- **Bbox image overlay** — vision-describer должен вернуть `boundingBoxes: [{x, y, w, h, label, score}]`. Backend нужно расширить vision-describer prompt чтобы извлекал bounding boxes (Haiku 4.5 умеет detection через structured output)
- **Bundled services** — «Монтаж под мойку 2 500 ₽» в product card. Source data — MoySklad service-products linked to filter-products через category mapping (нужен new endpoint `GET /catalog/products/{externalId}/bundled-services` или enrichment в same `/catalog/search` response)
- **History persistence** — Zustand recentQueries[] в localStorage (`smart-search:recent`, last 10)
- **FTUX coach** tooltip при первом открытии (если `localStorage.smart-search:coach-seen !== 'true'`)

### Phase 2 — Multi-modal premium (backlog)

- **Voice input** — `SpeechRecognition` API через native Web Speech (browser-only, no backend cost). Transcript inline до `onend`, потом submit как text query
- **Follow-up dialogue** — conversational state «а подешевле без монтажа?». Требует Flowise Chat (state-aware multi-turn) или own conversation manager. Backend: new endpoint `POST /catalog/search/refine` body `{previousQueryId, refinement: 'cheaper' | 'no-install' | ...}`
- **Desktop split-pane** — AI vision sidebar 280px + product grid 2×4 right с facet filters (Тип / Производитель / Цена)
- **Facet filters** — extension `/catalog/search` body `{filters: {category[], brand[], priceRange}}` + response with facet aggregations

---

## Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Vision-describer runtime cost** — Haiku 4.5 на user-submitted photos (не ingest-time как сейчас). 1000 daily users × 1 photo = ~$0.50/day. Скейл-up до 10K users = $5/day | Phase 1 — text-only first; photo Phase 1.5 после product-market fit. Image cache SHA256 уже есть (повтор того же photo → cached vision result) |
| 2 | **Hallucinations Vision на нерелевантных photos** — юзер загрузит кота → Vision напишет «домашнее животное». UX-проблема | `vision.confidence === 'low'` → UI shows «Не уверен что распознал. Может опишите словами?» fallback prompt |
| 3 | **`/catalog/search` throttle 10/min/IP** — на bursts (юзер быстро submit'ит 5 фото) → 429 | Phase 1 search-on-submit (Enter/button), не on-typing. Frontend debounce 600ms + AbortController cancel previous request |
| 4 | **Vision-augmented catalog не покрывает все scenarios** — «фильтр для дачи на лето» → нет в augmenter description, vector search не найдёт | Fallback: при `matchScore < 30` для всех результатов → UI «Не нашли по фото. Попробуйте описать словами или выбрать категорию» |
| 5 | **Conflict с existing equipment-suggest** — оба возвращают product cards, оба resemble. Юзер не различит | Phase 1: smart-search показывает **AI vision badge** + **bbox overlay** — visual differentiator. Equipment-suggest показывает severity badges и matchedProblem (water context). Разные UX cues |
| 6 | **Bundled services data missing** — MoySklad может не иметь service-products linked to filter-products | Phase 1.5 only — если data missing, не показывать. Phase 1 без bundled services |

---

## Что НЕ делаем в Phase 1

- ❌ Voice input (Phase 2)
- ❌ Follow-up dialogue (Phase 2)
- ❌ Desktop split-pane с facet filters (Phase 2)
- ❌ Bbox image overlay (Phase 1.5 после Vision-describer extension)
- ❌ Bundled services «Монтаж 2 500 ₽» (Phase 1.5)
- ❌ FTUX coach tooltip (Phase 1.5)
- ❌ Streaming AI pipeline progress (используем simulated stages с timers)
- ❌ Замена `EquipmentModal v5` — smart-search **дополняет**, не заменяет (когда юзер ставит pin → AutoEquipmentCard работает как раньше)

---

## Tracking

- Backend Phase 1 — slovo (мне), separate commit на `main`
- Frontend Phase 1 — prostor-claude в `feature/smart-search` branch
- Coordination — `prostor-app/docs/feedback/water-map-thread.md` thread с handoff updates
- Acceptance — Playwright sweep через https tunnel (mobile 390 + desktop 1280) после deploy

## Связанные документы

- `prostor-app/PROSTOR Smart Search.html` — design prototype (claude.ai design, 2026-05-15)
- `prostor-app/docs/feedback/water-map-smart-search-design-review-2026-05-15.md` — context prompt для claude design
- `prostor-app/docs/feedback/water-map-thread.md` — append-only лог обсуждений
- `docs/features/vision-catalog-search.md` — Phase 1+2 backend foundation (закрыта)
- `docs/features/prostor-water-pivot.md` — water-pivot plan (карта-first)
