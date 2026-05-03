# Vision Catalog — Phase 1 + Phase 2 завершены, передача фронт-команде

> Этот документ — **итог Phase 1 + Phase 2 vision-catalog-search**:
> что построено, что подтверждено живыми тестами, и **где это
> интегрировать в фронт** (`prostor-app` + `crm-aqua-kinetics-front`).
>
> Сопутствующие документы:
> - [vision-catalog-one-pager.md](vision-catalog-one-pager.md) — короткая ссылка для руководителя
> - [vision-catalog-executive-summary.md](vision-catalog-executive-summary.md) — экономика и финансовая модель
> - [vision-catalog-demo.md](vision-catalog-demo.md) — 7 e2e сценариев со скриншотами
> - [vision-catalog-ux-mockup.html](vision-catalog-ux-mockup.html) — UX-спецификация (3 состояния mobile flow + точка интеграции в главную + design-token капля). Live-просмотр через raw.githack: `https://raw.githack.com/Pelmenya/slovo/main/docs/management/vision-catalog-ux-mockup.html`
> - [vision-catalog-search.md](../features/vision-catalog-search.md) — техническая спецификация
> - [tech-debt.md](../architecture/tech-debt.md) — оставшиеся пункты до prod-выкатки

---

## TL;DR

**Сделано:** AI-поиск по каталогу Аквафор-Pro работает в трёх режимах
через один endpoint — текст / фото (1-5 шт) / комбинированно. На реальных
155 товарах, обогащённых AI-описаниями каждого фото (Phase 2). **Стоимость
всей разработки — ~39 ₽** за 9 дней работы с AI-провайдерами (Phase 0
за две недели до этого — без LLM-вызовов, только дизайн pipeline).

**Главный пользователь — клиенты на prostor-app.** Менеджеры
`crm-aqua-kinetics-front` используют тот же endpoint вторично.

**Что от фронта:** добавить поиск по фото/тексту в существующие
каталог-страницы `prostor-app` (Web + Telegram MiniApp + MAX MiniApp).
В CRM-front — опциональная интеграция для менеджеров. Один HTTP вызов,
типизированный контракт, готовый Swagger.

**Что осталось до прода:** 1 пункт инфраструктуры (webhook-trigger
вместо 4ч cron'а — опционально), UX-loader на фронте (1-2 дня Петра
— **спецификация готова** в [vision-catalog-ux-mockup.html](vision-catalog-ux-mockup.html):
3 состояния mobile flow с 3-step progress на loading-этапе).
Backend hardening полностью закрыт.

---

## Что сделано в Phase 1 + Phase 2

### Backend (slovo)

| Компонент | Что делает | Статус |
|---|---|---|
| `apps/worker/catalog-refresh` | Cron каждые 4 часа: читает `latest.json` из MinIO, переиндексирует каталог в Flowise через RecordManager (skip-if-unchanged, ~95× cost reduction) | ✅ работает |
| `apps/worker/.../vision-augmenter` | На ingest обогащает каждый товар визуальным описанием через Claude Haiku 4.5 | ✅ Phase 2 (2 мая) |
| `apps/api/catalog/search` | HTTP endpoint `POST /catalog/search` — единый для text/image/combined | ✅ 7 e2e сценариев |
| `apps/api/budget` | Защита от cost-burst — daily $-cap для Vision/Embedding + Telegram alert | ✅ #21 + #67 |
| `libs/common/.../ip-throttler` | Per-IP/IPv6-/64 throttle (anti-rotation) | ✅ #65 |
| Vision SHA256 image-cache | Повторные image-запросы клиента → 0 ₽ из Redis | ✅ #66 |
| Image-hash augmentation cache | Повторные refresh товара без changed photos → 0 ₽ Vision | ✅ #71 |
| Vision prompt v2 | Поддержка multi-image (1-5 фото одного товара → одно описание) | ✅ обновлён 1 мая |
| Provision-script | Воссоздание augmenter chatflow под git, с anti-injection prompt | ✅ `npm run provision:augmenter` |

### Тесты

- **591 unit-тест** (Jest, моки) — покрытие новых модулей и интеграции
- **e2e тесты** (NestJS supertest, моки внешних сервисов)
- **7 live e2e сценариев** через настоящий Flowise + Anthropic + OpenAI на реальных фото и каталоге (см. demo.md)
- **Полный re-augment 155 товаров** на Haiku 4.5: 498 секунд, $0.395 ≈ 32 ₽

### Реальные замеры стоимости (24 апр – 2 мая, 9 дней работы с AI)

Phase 0 (16-23 апр) — design chatflow и validation промптов на 6 фото —
без LLM-billing.

| Период | Сумма | Что в эту сумму вошло |
|---|---|---|
| OpenAI Embeddings (24 апр – 2 мая) | $0.012 ≈ **0,95 ₽** | Все переиндексации × 155 товаров + dev-тесты поиска |
| Anthropic Vision (1 мая, Sonnet runs) | $0.069 ≈ **5,5 ₽** | Vision describer тесты + multi-image отладка |
| Anthropic Haiku 4.5 (2 мая, Phase 2 augment) | $0.395 ≈ **32 ₽** | Полный re-augment 155 товаров с визуальными описаниями фото |
| Anthropic Sonnet (2 мая, demo runs) | $0.016 ≈ **1,3 ₽** | E2E demo на 7 сценариях |
| **Совокупно за всю разработку** | **~$0.49 ≈ 39 ₽** | 9 дней работы с production AI-моделями end-to-end |

Цифры с реальных billing-dashboards (OpenAI Usage + Anthropic Console
CSV), а не оценки. Phase 2 augmentation в 4× дешевле conservative
оценки благодаря Haiku 4.5 ($0.0026/item вместо $0.01).

---

## API контракт для фронта

**Один endpoint** — `POST /catalog/search`. Базовый URL зависит от
деплоя (для пилота — `http://slovo-api:3101` внутри docker-compose сети).

### Request

```typescript
type SearchRequest = {
    // Хотя бы одно из query/images обязательно
    query?: string;                    // 1..500 символов
    images?: Array<{
        base64: string;                 // base64 без data: prefix
        mime: 'image/jpeg' | 'image/png' | 'image/webp';
    }>;                                 // 1..5 штук, ≤5MB декодированных каждое
    topK?: number;                      // 1..50, default 10
};
```

### Response

```typescript
type SearchResponse = {
    count: number;                      // сколько товаров вернулось
    docs: Array<{
        id: string;
        pageContent: string;            // rich-text карточка с секцией
                                         // «Визуальный вид: ...» (Phase 2)
        metadata: {
            externalId: string;          // moysklad-uuid для cross-link
            externalType: string;        // product | service | cartridge | bundle
            name: string;
            description: string | null;
            categoryPath: string | null;
            salePriceKopecks: number | null;
            rangForApp: number | null;
            externalSource: string;
        };
        imageUrls: string[];            // готовые presigned S3 URLs (TTL 1ч)
    }>;
    timeTakenMs: number;
    visionOutput?: {                    // только если был передан images
        isRelevant: boolean;
        category: string | null;
        brand: string | null;
        modelHint: string | null;
        descriptionRu: string;
        confidence: 'high' | 'medium' | 'low';
    };
};
```

### Коды ответов

| Code | Когда | Action на фронте |
|---|---|---|
| 200 | Успех | Рендерить `docs` карточки + опц. visionOutput-бэйдж |
| 400 (validation) | Не передано query/images, превышены лимиты | Показать форму с подсказкой |
| 400 (vision-irrelevant) | Vision не распознал оборудование (`is_relevant=false`) | Показать `visionOutput.descriptionRu` + кнопку «Уточнить текстом» |
| 429 | Rate limit (10/min/IPv6-/64) | Toast «Слишком много запросов, подождите минуту» |
| 502 | Vision сломался (Anthropic upstream) | Toast «AI временно недоступен, попробуйте текстом» |
| 503 | Daily Vision/Embedding budget cap превышен | Toast «Лимит на сегодня исчерпан, до полуночи UTC» |

### Swagger UI

Полный контракт + «Try it out» — `http://slovo-api:3101/api/docs`
(только в dev окружении, в prod закроется).

---

## Где внедрять на фронте

### `prostor-app` (Web + Telegram MiniApp + MAX MiniApp) — ГЛАВНЫЙ КАНАЛ

**Сценарий 1: каталожный поиск на главной**

Заменить текущий поиск-бар на новый AI-поиск:

```
[ 🔍 Найти товар или загрузить фото... ]  📷
```

- Текстовый ввод → POST `/catalog/search` с `{ query }`
- Кнопка камеры/галереи → upload → POST с `{ images: [...] }`
- Combined: текст + кнопка «📷 Уточнить фото» → POST с обоими

Layout group: `(web)/catalog/page.tsx` — основной публичный каталог.
Mobile-first (Tailwind `md:` breakpoint).

**Сценарий 2: «Найти похожее» на карточке товара**

На каждой product-card добавить кнопку «📷 Найти похожее» — открывает
модалку с upload, делает image-only поиск.

**Сценарий 3: Telegram MiniApp прямой share фото**

В Telegram пользователь шарит фото боту → MiniApp open → автоматически
кладёт фото в search input → `image-only` режим. Использовать
`@telegram-apps/sdk-react` для file API.

**Что нужно в `prostor-app`:**
- API client (рекомендую генерить из Swagger через `@hey-api/openapi-ts`) — это уже в roadmap `prostor-app/docs/strategy/SUMMARY.md`
- Хук `useCatalogSearch(input)` поверх TanStack Query
- Component `<ImageUploader>` — drag & drop + mobile camera trigger
- Component `<VisionBanner>` — показывает «AI распознал: умягчитель Аквафор (high)» когда `visionOutput` присутствует
- Loading state — text search ~0.5-2s, image search ~3-7s (UX должен показывать прогресс по-разному)

### `crm-aqua-kinetics-front` (CRM для менеджеров) — ВТОРИЧНЫЙ КАНАЛ

**Сценарий: WhatsApp фото от клиента**

Клиент прислал фото фильтра в WhatsApp → менеджер делает screenshot или
drag-and-drop в CRM → `image-only` поиск → видит подходящие товары
с ценами и услугами монтажа.

UI добавляется в существующий «Каталог»-таб менеджера. Размер интеграции
меньше чем `prostor-app` потому что CRM — Telegram-only single platform.

**Что нужно в CRM-front:**
- Те же API client + хуки (если шарятся — выделить в общую npm-пакет)
- File upload компонент (Telegram WebApp file API)
- Опционально: сохранение истории поисков в карточке клиента

---

## Реалистичные UX-нюансы

> **Все паттерны ниже визуализированы** в [vision-catalog-ux-mockup.html](vision-catalog-ux-mockup.html)
> — 3 состояния mobile flow (idle / loading с 3-step progress / results
> с Vision-badge), точка интеграции в главную (sticky-инпут + FAB-камера),
> design-token «капля + sparkle». Live-просмотр:
> `https://raw.githack.com/Pelmenya/slovo/main/docs/management/vision-catalog-ux-mockup.html`

| Нюанс | Что учесть | Решение в mockup |
|---|---|---|
| Vision latency 3-7s | Не блокировать кнопку — показать spinner + «AI смотрит фото...» текст. Дать возможность отменить запрос (`AbortController`) | LOADING-state с 3-step progress: «Фото распознано» → «Подбираем товары» → «Услуги и расходники» + скелетон карточек |
| Multi-image (5 фото) | Vision на 5 фото может занять 8-12s. Показать прогресс «Анализ фото 1/5...» через WebSocket? Или просто spinner | Тот же 3-step progress (Vision API возвращает один общий response для batch'а) |
| Vision irrelevant (cat-фото) | Показать `descriptionRu` от AI («На фото — кот, не оборудование») + кнопку «Загрузить другое фото» — UX-friendly | Vision-badge с категорией и confidence + текст «Уточнить запрос» |
| Mobile / 3G сети | 5MB image при upload через 3G — 30-60s. Resize на клиенте (sharp в Node-ssr / canvas в браузере) до 1024×1024 → ~150KB | — (бэкенд-агностично, держим в backlog фронта) |
| Rate limit 10/min | Per-IP/IPv6-/64 prefix. Disable кнопку на 60s после ошибки 429. Authenticated клиент после auth-модуля получит ×3 | — (frontend toast, не в mockup) |
| Cost awareness | Image search в 12 000 раз дороже text. UX приём: «Сначала текстом, если не нашли — попробуйте фото» — снижает spend | IDLE-state приоритезирует текстовый input, FAB-камера — вторичная |

---

## Готовность к prod-запуску

### ✅ Готово
- API контракт стабилен (один endpoint, три режима)
- 591 unit-тестов + e2e + 7 live integration сценариев
- Cost tracking (Redis daily counters) + Telegram alert на превышение
- Per-IP/IPv6-/64 throttle (anti-rotation, защита от distributed botnet)
- Vision SHA256 image-cache (повторные фото клиента → 0 ₽)
- Vision augmentation на ingest (Phase 2 — точность image search значительно выше)
- Health checks (`GET /health`, `GET /health/ready`)
- Swagger UI документация
- Дефолтный budget cap $5 Vision + $1 embedding
- Multi-image работает (после prompt v2 fix 1 мая)
- `npm run refresh:once` CLI для manual trigger
- `npm run provision:augmenter` под git с типизацией

### 🟡 Требуется до prod (tech-debt)
- **Webhook-trigger** (#37/#68) — заменит cron 4ч на push от CRM при write в MinIO. **Опционально** — без него работает с задержкой 4ч
- **Auth-модуль** (`#17`) — сейчас endpoint открыт. Без auth rate-limit per-IP остаётся главной защитой
- **Langfuse alerts** на budget exceedance — сейчас Telegram alert работает, Langfuse — углубление observability
- **Helmet middleware** — стандартные security headers

### 🟢 Хорошо иметь
- Per-user budget после auth — справедливо распределить лимит между менеджерами
- Запись истории поисков в Prisma — для analytics конверсии клиентов
- Image resize на клиенте (mobile UX) — снижение payload
- A/B тест relevance: 1 vs 2 vs 3 фото — какое количество оптимально
- Vision prompt дальнейшие итерации — если конкретные категории misclassify
- Hybrid search ts_vector + embeddings (#40) — при росте каталога ×10

---

## Известные ограничения

1. **Vision-описание зависит от prompt v2** — если Anthropic выкатит breaking changes в Sonnet 4.6 vision API, prompt может потребовать adjustment. Тестируется live в Flowise UI.
2. **Single Document Store** — каталог только Аквафор-Pro, мульти-каталог (Atoll, Гейзер) потребует extension `CATALOG_AQUAPHOR_STORE_NAME` → массив + per-tenant routing.
3. **Cost protection — soft cap** — после превышения $5/день Vision клиент видит 503. Нет fallback на «дешёвый режим» (например text-only). При prod-нагрузке стоит подумать.
4. **Локализация** — system prompt Vision и system message русскоязычные. Для en-локали потребуется отдельный chatflow.

---

## Роадмап после Phase 2

| Phase | Срок | Содержание |
|---|---|---|
| **Phase 3 — фронт-интеграция** | 1-2 недели | `prostor-app` (главный канал) + `crm-aqua-kinetics-front` (вторично). Параллельно — webhook-trigger #37 в slovo |
| **Phase 4 — A/B и метрики** | 1-2 недели | Запуск на клиентов prostor-app, замер реального трафика (доля image vs text, конверсия в заказ) |
| **Phase 5 — расширение** | 2-3 недели | Water-analysis (анализ воды по фото бланка) поверх готовой инфраструктуры catalog-search |

---

## Что нужно от руководителя для следующего шага

1. **Бюджет на AI-расходы** — текущий $5/день выдерживает 200-500 запросов
   image-search. Для активного пилота 1000+ запросов/день нужно:
   - Расширить cap до $20-50/день (600-1 500 ₽), или
   - Стартовать со строгими anonymous-лимитами (3 image/мин) и ослаблять
2. **Сроки запуска** — backend готов сейчас, опционально webhook-trigger
   (1-2 вечера разработки) для мгновенной синхронизации
3. **152-ФЗ архитектура** — split на РФ-сегмент + EU LLM-gateway, план
   в ADR-007. Утверждать сейчас или Phase 5?
4. **Бюджет на интеграцию фронта** — Пётр в `prostor-app`, slovo-сторона
   API готова

---

## Краткий список deliverables (для checklist руководителя)

- [x] Backend slovo: `apps/api`, `apps/worker`
- [x] Catalog ingest pipeline (CRM → MinIO → Flowise через slovo orchestrate)
- [x] Universal search endpoint `POST /catalog/search`
- [x] Vision multi-image support
- [x] Phase 2 Vision augmentation на ingest (Haiku 4.5)
- [x] Image SHA256-cache для runtime повторов
- [x] Image-hash cache для ingest повторов
- [x] Per-IP/IPv6-/64 throttle (anti-rotation)
- [x] Budget cost protection + Telegram alert
- [x] CLI `npm run refresh:once` + `npm run provision:augmenter`
- [x] 591 unit-тестов + 7 live e2e сценариев
- [x] Документация (one-pager + executive summary + demo + handoff + tech spec)
- [x] Реальные cost-замеры с двух AI-провайдеров
- [ ] Webhook-trigger #37 (опционально, ускоряет sync)
- [ ] Auth-модуль (зависимость для prod)
- [ ] Frontend integration (`prostor-app`, `crm-aqua-kinetics-front`)
- [ ] A/B тест на пилотных клиентах prostor-app

---

**Контакт по техническим вопросам:** разработчик slovo (этот репозиторий).
**Контакт по UX-вопросам:** фронт-команда `prostor-app`.
