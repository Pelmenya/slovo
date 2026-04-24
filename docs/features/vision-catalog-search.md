# Vision Catalog Search

> **Статус:** 🟡 черновик / Phase 1 — Flowise эксперименты
> **Связи:** [knowledge-base.md](knowledge-base.md), [ADR-006](../architecture/decisions/006-knowledge-base-as-first-feature.md), [ADR-004 Claude primary](../architecture/decisions/004-claude-as-primary-llm.md)

Фича: **поиск товара/услуги в каталоге Аквафор-Pro по фото или тексту**. Встраивается в CRM дилера — клиент прислал фото сломанного узла, дилер за пару секунд видит подходящую замену из 500 товаров MoySklad.

---

## Что строим

Гибридный поиск по каталогу из MoySklad:
- **text query** `"фильтр для жёсткой воды"` → embedding → pgvector cosine top-K
- **image query** фото узла → Claude Vision → структурированное описание → embedding → тот же pgvector top-K

Каталог синхронизируется с MoySklad периодически (delta sync с content hash и soft-delete).

---

## Зачем

1. **Замена вручную-листания каталога.** Дилер находит нужное за секунды, не минуты.
2. **SME-ассистент для новых инженеров.** `"всё про обезжелезиватели, диапазон цен"` — smart-filtering вместо иерархии папок.
3. **Vision для клиентских кейсов.** Клиент прислал WhatsApp фото — не надо просить «опишите модель», AI определяет сам.
4. **Фундамент для water-analysis.** Когда AI рекомендует «нужен обратный осмос» — из каталога сразу тянется конкретный SKU с ценой.

---

## Pipeline

### Ingestion (sync с MoySklad, раз в сутки / по триггеру)

```mermaid
flowchart LR
    CRON[Cron / manual POST /catalog/sync] --> FETCH[GET MoySklad entity/product]
    FETCH --> DIFF{content_hash<br/>изменился?}
    DIFF -->|да или нет записи| EMBED[OpenAI text-embedding-3-small]
    EMBED --> DB[(catalog_items<br/>+ embedding vector 1536)]
    DIFF -->|нет| META[UPDATE только metadata<br/>price, attrs, last_seen_at]
    META --> DB
    FETCH --> SEEN[SET last_seen_at = NOW]
    SEEN --> GC[SOFT-DELETE если<br/>last_seen_at &lt; sync_start]
    GC --> DB
```

**Детали:**
- `content_hash = SHA-256(name + description)` — маркер изменения _текстовых_ полей (того что идёт в embedding). Изменение цены или атрибутов **не** триггерит пересчёт embedding — экономит 90% OpenAI-вызовов при типичном паттерне.
- `last_seen_at` каждого присутствующего в API товара обновляется. После sync — все `last_seen_at < sync_start` помечаются `deleted_at = NOW()`. Soft-delete, не жёсткое удаление: дилер может искать снятый с продажи товар.
- Visibility: фильтр `isVisible` из атрибута `IS_VISIBLE_FOR_APP` MoySklad. Хранится как колонка, чтобы unhide не требовал пересчёта embedding.

### Query — text

```mermaid
sequenceDiagram
    participant Client
    participant API as /catalog/search/text
    participant OAI as OpenAI embeddings
    participant PG as pgvector (HNSW)

    Client->>API: { q: "фильтр для жёсткой воды", limit: 5 }
    API->>OAI: embed(q)
    OAI-->>API: vector[1536]
    API->>PG: SELECT *, embedding <-> $1 AS distance<br/>FROM catalog_items<br/>WHERE is_visible AND deleted_at IS NULL<br/>ORDER BY embedding <-> $1<br/>LIMIT 5
    PG-->>API: top-5 items
    API-->>Client: [ { id, name, price, imageUrl, score } ]
```

### Query — image (hybrid)

```mermaid
sequenceDiagram
    participant Client
    participant API as /catalog/search/image
    participant CV as Claude Vision<br/>(sonnet-4-6)
    participant OAI as OpenAI embeddings
    participant PG as pgvector

    Client->>API: multipart image + { limit: 5 }
    API->>CV: messages.create with image block + prompt
    CV-->>API: structured JSON { category, model_hint, features[], description }
    API->>OAI: embed(description + features)
    OAI-->>API: vector[1536]
    API->>PG: cosine top-K SELECT
    PG-->>API: top-5 items
    API-->>Client: { items, vision_output } (оба — для прозрачности)
```

**Почему "hybrid":** Vision даёт текст → embedding от текста → поиск по каталогу embedding'ов. Не сравниваем image embedding напрямую с текст embedding — это разные семантические пространства (CLIP решает эту проблему, но не нужен при 500 товарах — text bridge проще).

---

## Схема данных

```prisma
model CatalogItem {
    id                 String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
    moyskladId         String    @unique @map("moysklad_id")
    moyskladType       String    @map("moysklad_type")            // product | service | bundle
    name               String    @db.VarChar(512)
    description        String?   @db.Text
    attributes         Json?                                       // raw MoySklad attributes
    salePriceKopecks   Int?      @map("sale_price_kopecks")       // в копейках, без float
    categoryPath       String?   @map("category_path")
    imageUrl           String?   @map("image_url")
    isVisible          Boolean   @default(true) @map("is_visible")

    // Delta-sync маркеры
    contentHash        String    @map("content_hash") @db.Char(64) // SHA-256(name + description)
    moyskladUpdatedAt  DateTime  @map("moysklad_updated_at")
    lastSeenAt         DateTime  @default(now()) @map("last_seen_at")
    deletedAt          DateTime? @map("deleted_at")

    createdAt          DateTime  @default(now()) @map("created_at")
    updatedAt          DateTime  @updatedAt @map("updated_at")

    // Колонка embedding vector(1536) добавляется отдельной миграцией
    // (Prisma не поддерживает pgvector типы декларативно, см. ADR-005).
    // + HNSW-индекс с vector_cosine_ops.

    @@index([isVisible, deletedAt])
    @@index([lastSeenAt])
    @@index([moyskladUpdatedAt])
    @@map("catalog_items")
}
```

Отдельная таблица, не `knowledge_sources` — разные домены (user uploads vs org catalog), разные lifecycle (ad-hoc vs periodic sync), разная авторизация (user-scoped vs read-all / admin-sync).

---

## Фазы реализации

| PR | Скоуп | Новая технология |
|---|---|---|
| **Phase 0 (сейчас)** | Flowise chatflow "Vision Describer" — экспериментируем с промптами и форматом structured output. Финальный промпт уходит в `libs/llm/prompts/vision-catalog.ts`. | Claude Vision в Flowise UI |
| **PR5** | `libs/llm/` — тонкая обёртка над `@anthropic-ai/sdk` с vision-методом + `POST /vision/describe` endpoint. Multer upload, base64 encode, Claude sonnet-4-6. Без каталога пока — просто "image → JSON". | Anthropic SDK, multipart upload |
| **PR6** | `CatalogItem` модель + миграция + `CatalogSyncService` + `POST /catalog/sync` manual trigger. Delta-sync с content hash, soft-delete через last_seen_at. Embeddings **пока не считаем**. | Prisma migration, MoySklad API integration |
| **PR7** | `ALTER TABLE ADD COLUMN embedding vector(1536)` + HNSW индекс миграцией. Интеграция с OpenAI embeddings API. `/catalog/search/text` endpoint. | pgvector HNSW, OpenAI embeddings |
| **PR8** | `/catalog/search/image` — полный hybrid pipeline из PR5-7 склеен. Swagger примеры с реальными фото. | End-to-end e2e |
| **PR9** (потом) | `@nestjs/schedule` cron + webhooks MoySklad + reconciliation | Cron + webhook handlers |

---

## Phase 0 — что делаем сейчас в Flowise

**Цель:** подобрать промпт для Vision который даёт стабильный structured JSON для поиска по каталогу.

### Chatflow "Vision Describer" в Flowise

Ноды:
- **ChatAnthropic** — `claude-sonnet-4-6`, поддержка image input через messages
- **Prompt Template** — инструкция "опиши в JSON"
- **Structured Output Parser** (или свой JSON prompt)

### Какой структуры JSON хотим

```json
{
  "category": "обратный осмос",
  "model_hint": "Aquaphor DWM-101S",
  "brand": "Аквафор",
  "features": ["5-ступенчатая очистка", "обратный осмос", "минерализатор"],
  "condition": "внешне исправен",
  "description_ru": "Бытовой фильтр обратного осмоса Аквафор DWM-101S. Пять ступеней очистки с минерализатором. Под мойкой, накопительный бак."
}
```

`description_ru` — это то, что пойдёт в embedding. Остальные поля — для фильтрации / отображения.

### Что проверяем в Flowise (чек-лист)

- [ ] Claude Sonnet видит загруженное изображение
- [ ] Возвращает **валидный JSON** без markdown-обёрток (` ```json `)
- [ ] Русский язык в полях выдерживается
- [ ] На мутных/плохих фото отвечает `{ "category": null, "confidence": "low" }` а не галлюцинирует
- [ ] На не-фильтре (пёс, котёнок) честно говорит `null`
- [ ] Стабильность — одну и ту же картинку прогнать 3 раза, сравнить output

### Тестовый набор фото

Собрать 10-15 фото:
- Исправные фильтры Аквафор (разные модели)
- Сломанные узлы (картридж, мембрана, трубка)
- Коробки/упаковка
- Бланк анализа воды (edge case — AI должен сказать "это не оборудование")
- Случайные фото (кот, чашка кофе) — AI должен вернуть null

Результаты сложить в `docs/experiments/vision-catalog-${date}/` с JSON outputs — чтобы было что сравнивать между итерациями промптов.

---

## Что НЕ делаем в Phase 0

- ❌ Не пишем NestJS endpoint (прототипируем промпт в UI, не коде)
- ❌ Не импортируем каталог (прототипируем на 3-5 известных моделях вручную вписанных в промпт)
- ❌ Не считаем embeddings (только формируем текст который пойдёт в embedding позже)
- ❌ Не думаем про prod-деплой / cost optimization

Финал Phase 0 — **один JSON-файл с промптом который работает** + репорт "на 15 фото работает N/15 корректно". Этот промпт идёт в PR5.

---

## Открытые вопросы

1. **Кто тренирует промпт — ты или я?** Я могу сгенерить 3-4 варианта промпта, ты протестируешь на реальных фото. Или наоборот — ты пишешь, я даю обратную связь.
2. **Структура JSON output** — окей такая, или что-то добавить/убрать? Возможно `price_hint` (ориентировочная цена) если Claude узнаёт модель?
3. **Fallback если Vision не уверен.** Возвращать `confidence: 'low'` и запрашивать текст у пользователя? Или сразу искать по тому что распознали?
4. **Cost budget.** $0.003 за image в Sonnet. 100 запросов в день = $0.30. OK или целимся в Haiku ($0.001/img) ценой качества?

---

## Связи с другими фичами

- **knowledge-base** — те же принципы embedding + pgvector, но для другой сущности (user uploads). Catalog — отдельная модель.
- **water-analysis** (будет позже) — после распознавания параметров из бланка, рекомендует оборудование **через catalog search** — реюз пайплайна.
- **sme-cloning (video-to-artifact)** — аналогично, но vision для видео-кадров.
