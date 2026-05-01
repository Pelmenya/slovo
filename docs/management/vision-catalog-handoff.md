# Vision Catalog — Phase 1 завершена, передача фронт-команде

> Этот документ — **итог Phase 1 vision-catalog-search**: что построено, что подтверждено живыми тестами, и **где это интегрировать в фронт** (`prostor-app` + `crm-aqua-kinetics-front`).
>
> Сопутствующие документы:
> - [vision-catalog-executive-summary.md](vision-catalog-executive-summary.md) — бизнес-обоснование и финансовая модель
> - [vision-catalog-search.md](../features/vision-catalog-search.md) — техническая спецификация
> - [tech-debt.md](../architecture/tech-debt.md) — оставшиеся пункты до prod-выкатки

---

## TL;DR

**Сделано:** AI-поиск по каталогу Аквафор-Pro работает в трёх режимах через один endpoint — текст / фото (1-5 шт) / комбинированно. На реальных 155 товарах. **Стоимость всей разработки — 6,4 ₽** (две чашки кофе) за 8 дней работы с AI-провайдерами (Phase 0 за две недели до этого — без LLM-вызовов, только дизайн pipeline). Готов к интеграции с фронтом.

**Что от фронта:** добавить поиск по фото/тексту в существующие каталог-страницы `prostor-app` (Web + Telegram MiniApp + MAX MiniApp) и в менеджерский интерфейс `crm-aqua-kinetics-front`. Один HTTP вызов, типизированный контракт, готовый Swagger.

**Что осталось до прода:** 2 пункта инфраструктуры (auth-модуль + per-IP rate-limit для Vision); фича-логика готова и протестирована.

---

## Что сделано в Phase 1

### Backend (slovo)

| Компонент | Что делает | Статус |
|---|---|---|
| `apps/worker/catalog-refresh` | Cron каждые 4 часа: читает `latest.json` из MinIO, переиндексирует каталог в Flowise | ✅ работает на 155 товарах |
| `apps/api/catalog/search` | HTTP endpoint `POST /catalog/search` — единый для text/image/combined | ✅ 5 e2e сценариев пройдены |
| `apps/api/budget` | Защита от cost-burst — daily $-cap для Vision/Embedding (#21 закрыт) | ✅ counter работает в Redis |
| Vision prompt v2 | Поддержка multi-image (1-5 фото одного товара → одно описание) | ✅ обновлён в Flowise 1 мая |
| Прайс presigned URLs | Картинки товаров отдаются клиенту через S3 presigned (TTL 1ч) | ✅ кэшируются в Redis |

### Тесты

- **474 unit-теста** (Jest, моки)
- **37 e2e тестов** (NestJS supertest, моки внешних сервисов)
- **5 live e2e сценариев** через настоящий Flowise + Anthropic + OpenAI на реальных фото и каталоге

### Реальные замеры стоимости (24 апр – 1 мая, 8 дней активной работы с AI)

Phase 0 (16-23 апр) — design chatflow в Flowise UI и validation промптов на 6 фото — без LLM-billing. Phase 1 (с 24 апреля) — реальные API-вызовы:

| Провайдер | Сумма | Что в эту сумму вошло |
|---|---|---|
| OpenAI Embeddings (24 апр – 1 мая) | $0.0106 ≈ **0,85 ₽** | 2 полных переиндексации × 155 товаров + все dev-тесты поиска |
| Anthropic Vision (1 мая, основной день) | $0.069 ≈ **5,5 ₽** | Все vision-тесты + multi-image отладка (3 цикла retest) |
| **Phase 1 совокупно** | **~6,4 ₽** | 8 дней работы с production AI-моделями end-to-end |

Цифры с реальных billing-dashboards (OpenAI Usage + Anthropic Console CSV), а не оценки.

---

## API контракт для фронта

**Один endpoint** — `POST /catalog/search`. Базовый URL зависит от деплоя (для пилота — `http://slovo-api:3101` внутри docker-compose сети).

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
        pageContent: string;            // rich-text карточка
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
| 429 | Rate limit (5/min/IP) | Toast «Слишком много запросов, подождите минуту» |
| 502 | Vision сломался (Anthropic upstream) | Toast «AI временно недоступен, попробуйте текстом» |
| 503 | Daily Vision/Embedding budget cap превышен | Toast «Лимит на сегодня исчерпан, до полуночи UTC» |

### Swagger UI

Полный контракт + «Try it out» — `http://slovo-api:3101/api/docs` (только в dev окружении, в prod закроется).

---

## Где внедрять на фронте

### `prostor-app` (Web + Telegram MiniApp + MAX MiniApp)

**Сценарий 1: каталожный поиск на главной**

Заменить текущий поиск-бар на новый AI-поиск:

```
[ 🔍 Найти товар или загрузить фото... ]  📷
```

- Текстовый ввод → POST `/catalog/search` с `{ query }`
- Кнопка камеры/галереи → upload → POST с `{ images: [...] }`
- Combined: текст + кнопка «📷 Уточнить фото» → POST с обоими

Layout group: `(web)/catalog/page.tsx` — основной публичный каталог. Mobile-first (Tailwind `md:` breakpoint).

**Сценарий 2: «Найти похожее» на карточке товара**

На каждой product-card добавить кнопку «📷 Найти похожее» — открывает модалку с upload, делает image-only поиск.

**Сценарий 3: Telegram MiniApp прямой share фото**

В Telegram пользователь шарит фото боту → MiniApp open → автоматически кладёт фото в search input → `image-only` режим. Использовать `@telegram-apps/sdk-react` для file API.

**Что нужно в `prostor-app`:**
- API client (рекомендую генерить из Swagger через `@hey-api/openapi-ts`) — это уже в roadmap `prostor-app/docs/strategy/SUMMARY.md`
- Хук `useCatalogSearch(input)` поверх TanStack Query
- Component `<ImageUploader>` — drag & drop + mobile camera trigger
- Component `<VisionBanner>` — показывает «AI распознал: умягчитель Аквафор (high)» когда `visionOutput` присутствует
- Loading state — text search ~0.5-2s, image search ~3-7s (UX должен показывать прогресс по-разному)

### `crm-aqua-kinetics-front` (CRM для менеджеров, Telegram-only)

**Сценарий: WhatsApp фото от клиента**

Клиент прислал фото фильтра → менеджер делает screenshot или drag-and-drop в CRM → `image-only` поиск → видит подходящие товары с ценами и услугами монтажа.

UI добавляется в существующий «Каталог»-таб менеджера. Размер интеграции меньше чем `prostor-app` потому что CRM — Telegram-only single platform.

**Что нужно в CRM-front:**
- Те же API client + хуки
- File upload компонент (Telegram WebApp file API)
- Опционально: сохранение истории поисков в карточке клиента (для последующего follow-up)

---

## Реалистичные UX-нюансы

| Нюанс | Что учесть |
|---|---|
| Vision latency 3-7s | Не блокировать кнопку — показать spinner + «AI смотрит фото...» текст. Дать возможность отменить запрос (`AbortController`) |
| Multi-image (5 фото) | Vision на 5 фото может занять 8-12s. Показать прогресс «Анализ фото 1/5...» через WebSocket? Или просто spinner |
| Vision irrelevant (cat-фото) | Показать `descriptionRu` от AI («На фото — кот, не оборудование») + кнопку «Загрузить другое фото» — UX-friendly |
| Mobile / 3G сети | 5MB image при upload через 3G — 30-60s. Resize на клиенте (sharp в Node-ssr / canvas в браузере) до 1024×1024 → ~150KB |
| Rate limit 5/min | Маловато для агрессивного UI «попробуй ещё». Disable кнопку на 60s после ошибки 429 |
| Cost awareness | Image search в 700 раз дороже text. Возможно UX приём: «Сначала текстом, если не нашли — попробуйте фото» — снижает spend |

---

## Готовность к prod-запуску

### ✅ Готово
- API контракт стабилен (один endpoint, три режима)
- Тесты unit + e2e + live integration
- Cost tracking (Redis daily counters)
- Health checks (`GET /health`, `GET /health/ready`)
- Swagger UI документация
- Дефолтный budget cap $5 Vision + $1 embedding
- Multi-image работает (после prompt v2 fix 1 мая)

### 🟡 Требуется до prod (tech-debt)
- **Auth-модуль** (`#17`) — сейчас endpoint открыт, в prod нужен JWT. Без этого rate-limit 5/min/IP легко обходится через distributed botnet
- **Per-IPv6-subnet rate limit** (`#21` residual) — IPv6 /64 prefix tracking в ThrottlerStorage
- **Langfuse alerts** на budget exceedance — сейчас только counter в Redis, alert на пороге 80% полезен
- **MinIO digest-pin** для prod (`memory: project_minio_docker_hub_freeze`)
- **Helmet middleware** — стандартные security headers

### 🟢 Хорошо иметь
- Per-user budget после auth — справедливо распределить лимит между менеджерами
- Запись истории поисков в Prisma — для analytics конверсии
- Image resize на клиенте (mobile UX) — снижение payload
- A/B тест relevance: 1 vs 2 vs 3 фото — какое количество оптимально
- Vision prompt дальнейшие итерации — если конкретные категории misclassify

---

## Известные ограничения

1. **Vision-описание зависит от prompt v2** — если Anthropic выкатит breaking changes в Sonnet 4.6 vision API, prompt может потребовать adjustment. Тестируется live в Flowise UI.
2. **Single Document Store** — каталог только Аквафор-Pro, мульти-каталог (Atoll, Гейзер) потребует extension `CATALOG_AQUAPHOR_STORE_NAME` → массив + per-tenant routing.
3. **Cost protection — soft cap** — после превышения $5/день Vision клиент видит 503. Нет fallback на «дешёвый режим» (например text-only). При prod-нагрузке стоит подумать.
4. **Локализация** — system prompt Vision и system message русскоязычные. Для en-локали потребуется отдельный chatflow.

---

## Роадмап после Phase 1

| Phase | Срок | Содержание |
|---|---|---|
| **Phase 2 — фронт-интеграция** | 1-2 недели | `prostor-app` + `crm-aqua-kinetics-front`. Параллельно — auth-модуль в slovo |
| **Phase 3 — A/B и метрики** | 1 неделя | Запуск на 2-3 пилотных менеджеров, замер KPI (время подбора, конверсия) |
| **Phase 4 — расширение** | 2-3 недели | Water-analysis (анализ воды по фото бланка) поверх готовой инфраструктуры catalog-search |

---

## Что нужно от руководителя для следующего шага

1. **Согласование пилота** — 2-3 дилерских менеджера для замеров KPI
2. **Решение по auth-модели** — JWT для веб + Telegram initData для MiniApp + MAX initData (план в `prostor-app/docs/features/auth/AUTH_ADAPTER.md` уже есть)
3. **Решение по cost** — поднимать ли $5 Vision daily cap при пилоте на 5 менеджеров (по факту ~360 ₽/мес = $4.5, в лимит укладываемся; но если каждый менеджер активно листает — может зашкалить)
4. **Бюджет на интеграцию** — фронтовая работа в `prostor-app` ведёт основной разработчик `prostor-app`, slovo-сторона API готова

---

## Краткий список deliverables (для checklist руководителя)

- [x] Backend slovo: `apps/api`, `apps/worker`
- [x] Catalog ingest pipeline (CRM → MinIO → Flowise через slovo orchestrate)
- [x] Universal search endpoint `POST /catalog/search`
- [x] Vision multi-image support
- [x] Budget cost protection
- [x] 474 unit + 37 e2e + 5 live тестов
- [x] Документация (executive summary + tech spec + handoff)
- [x] Реальные cost-замеры с двух AI-провайдеров
- [ ] Auth-модуль (зависимость для prod)
- [ ] Frontend integration (`prostor-app`, `crm-aqua-kinetics-front`)
- [ ] A/B тест на пилотных менеджерах
- [ ] Alerts на cost-burst (Langfuse)

---

**Контакт по техническим вопросам:** разработчик slovo (этот репозиторий).
**Контакт по UX-вопросам:** фронт-команда `prostor-app` + `crm-aqua-kinetics-front`.
