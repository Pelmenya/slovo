# Vision Catalog Search

> **Статус:** 🟡 черновик / Phase 1 — Flowise эксперименты
> **Связи:** [knowledge-base.md](knowledge-base.md), [ADR-006](../architecture/decisions/006-knowledge-base-as-first-feature.md), [ADR-004 Claude primary](../architecture/decisions/004-claude-as-primary-llm.md)

Фича: **поиск товара/услуги в каталоге Аквафор-Pro по фото или тексту**. Встраивается в `crm-aqua-kinetics` (собственный продукт разработчика) — пользователь CRM (менеджер / инженер) присылает фото сломанного узла, за пару секунд видит подходящую замену из каталога ~500 товаров MoySklad.

---

## Что строим

Гибридный поиск по каталогу:
- **text query** `"фильтр для жёсткой воды"` → embedding → pgvector cosine top-K
- **image query** фото узла → Claude Vision → структурированное описание → embedding → тот же pgvector top-K

Каталог наполняется **push-модели** от внешних систем (CRM, 1С, ручной импорт): slovo получает events `/catalog/items/bulk` и апсертит. Сам slovo **не знает** что такое MoySklad — это generic RAG-слой над каталогом.

---

## Зачем

1. **Замена вручную-листания каталога.** Пользователь CRM находит нужное за секунды, не минуты.
2. **SME-ассистент для новых сотрудников.** `"всё про обезжелезиватели, диапазон цен"` — smart-filtering вместо иерархии папок.
3. **Vision для клиентских кейсов.** Клиент прислал WhatsApp фото — не надо просить «опишите модель», AI определяет сам.
4. **Фундамент для water-analysis.** Когда AI рекомендует «нужен обратный осмос» — из каталога сразу тянется конкретный SKU с ценой.

---

## Архитектурные решения

### Развёртывание

**slovo — standalone API-сервис.** Отдельный репо, отдельный Docker deploy, HTTP API для внешних feeder'ов. `crm-aqua-kinetics-back` — первый feeder, подключается через HTTP к `POST /catalog/items/bulk` и query endpoints.

**Долгосрочный путь (когда усложнится):** выделить pure logic в `slovo/libs/catalog/` + публиковать как `@slovo/catalog` в private npm registry. CRM получит выбор — HTTP или прямой импорт lib. Сейчас YAGNI, начинаем с HTTP.

### Embedding — через Flowise, не напрямую OpenAI

По решению в `memory/project_flowise_runtime_decision.md` (2026-04-22): **Flowise — LLM runtime, slovo — тонкий HTTP клиент**. slovo-api НЕ вызывает OpenAI SDK напрямую.

**Причины этого решения:**
- Flowise на Linux Alpine — корректный TLS fingerprint (OpenAI не блокирует, в отличие от Windows node.js)
- Credentials OpenAI/Anthropic живут в одном месте — Flowise Credentials UI
- Flowise умеет multi-provider (OpenAI / Anthropic / Cohere / Ollama) — переключение без изменения slovo-кода
- В prod это split-архитектуре (152-ФЗ): slovo-api в РФ, Flowise в EU zone
- Observability через Langfuse уже встроена во Flowise
- Streaming и prompt caching — фичи Flowise из коробки

**Embedding provider:** `OpenAI text-embedding-3-small` 1536 dim — настраивается **в Flowise-ноде**, slovo про это не знает. Переключить в будущем на Cohere / Ollama — меняем ноду во Flowise UI, slovo не трогаем.

### Rich context сборка — на стороне feeder'а

**Feeder (crm-aqua-kinetics-back) сам собирает текст для embedding** и шлёт в slovo готовый `contentForEmbedding: string`. Причины:
- CRM уже знает про System Bundle структуру MoySklad, `parseServiceRefs`, `parseComponentRefs`, `GroupService.getGroupBundle`
- slovo остаётся generic — просто форвардит то что пришло Flowise'у, не парсит чужие custom-attributes
- Новый feeder (1С когда будет) сам решает как собирать rich text

Что включает feeder в `contentForEmbedding`:
```
Товар: ${product.name}
${product.description ? 'Описание: ' + product.description : ''}
Категория: ${group.pathName}
Контекст группы: ${systemBundle?.description ?? ''}
${relevant_attributes.map(a => a.name + ': ' + a.value).join('\n')}
```

slovo принимает эту строку + метаданные → кладёт метаданные в свою Prisma БД + шлёт текст в Flowise upsert endpoint (Flowise эмбедит и хранит в своём pgvector).

### Services: единая таблица, не отдельная

`CatalogItem` с discriminator `type: 'product' | 'service' | 'bundle' | 'cartridge'`. Все — в одной pgvector таблице.
- Услуги ищутся текстом (`"монтаж обратного осмоса"`) — embedding pipeline тот же
- Image search фильтрует `WHERE type IN ('product', 'cartridge')`, услуги исключаются
- Связи через ID list в JSONB `attributes` (MVP) — не нормализуем таблицы связей пока не понадобится reverse lookup

### Игнорируем кривые категории MoySklad как primary signal

MoySklad `ProductFolder.pathName` — **не таксономия**, а исторически сложенная иерархия менеджеров. Используем только как **дополнительный сигнал** в rich text для embedding. Основной matching — через semantic similarity по description/attributes/group-context, не через filter WHERE category=X.

Если Vision вернул `category: "обратный осмос"` — используем для **ranking boost** при совпадении, но не для жёсткого фильтра.

---

## Flowise chatflows (Phase 0 — создаём в UI)

**Нужно два chatflow:**

1. **`vision-catalog-describer-v1`** (уже готов в Phase 0, 2026-04-24) — фото → JSON описание товара через Claude Vision. Используется в image search pipeline как первый шаг.

2. **`catalog-embed-search`** (создать в Phase 0 следующим шагом) — для товарного каталога:
   - **OpenAI Embeddings** нода — `text-embedding-3-small`, 1536 dim, credentials из Flowise
   - **Postgres Vector Store** нода — подключение к той же slovo БД (`slovo-postgres:5432`), Flowise сам создаст таблицу `langchain_pg_embedding` или подобную
   - **Custom JSON Loader** / **Document Store** — для приёма items через upsert API
   - **Retriever-only output** (без LLM ноды) — чтобы prediction API возвращал ranked docs, не generated answer

**Flowise API endpoints** (у каждого chatflow свой ID):
- Upsert: `POST /api/v1/vector/upsert/<catalog-embed-search-id>` — JSON body с текстами
- Search: `POST /api/v1/prediction/<catalog-embed-search-id>` — text query → ranked docs с metadata

**Credentials в Flowise:**
- `anthropic-dev` (уже есть) — для Vision chatflow
- `openai-dev` (создать) — для Embeddings ноды

---

## Pipeline

### Ingestion (push от внешних feeder'ов через bulk API)

```mermaid
flowchart LR
    subgraph external["Feeder'ы (CRM / 1C / скрипты)"]
        FEEDER[CRM cache<br/>invalidation / manual refresh]
    end

    FEEDER -->|POST /catalog/items/bulk<br/>+ API key| API[slovo<br/>CatalogIngestController]
    API --> PARSE[Валидация + нормализация]
    PARSE --> DIFF{content_hash<br/>изменился?}
    DIFF -->|новая запись<br/>или hash поменялся| FWUP[Flowise<br/>POST /api/v1/vector/upsert/catalog]
    FWUP --> EMBED[OpenAI text-embedding-3-small<br/>внутри Flowise]
    EMBED --> VSTORE[(pgvector<br/>Flowise-managed)]
    DIFF -->|hash совпадает| META[UPDATE только metadata<br/>price, attrs, last_seen_at]
    META --> META_DB[(catalog_items<br/>Prisma-managed)]
    PARSE --> META_DB
    PARSE -->|syncMode=full| GC[SOFT-DELETE Prisma items<br/>+ DELETE vectors в Flowise]
    GC --> META_DB
    GC --> FWDEL[Flowise vector delete]
```

**Детали:**
- **Push, не pull.** slovo не знает про MoySklad API / MOY_SKLAD_API_KEY. Feeder (`crm-aqua-kinetics-back` сейчас — собственный продукт разработчика с уже готовой интеграцией MoySklad, 1С или другой источник завтра) выкачивает данные из источника истины, нормализует в generic schema, шлёт в slovo. Добавить второй источник каталога = написать ещё одного feeder'а, slovo не трогается.
- **Два режима sync:**
  - `syncMode: "partial"` — feeder шлёт только изменённые items (при invalidation конкретного ключа Redis). Быстро, без soft-delete GC.
  - `syncMode: "full"` — feeder шлёт весь каталог (полный сброс кеша / manual refresh в админке). slovo чистит отсутствующие через `last_seen_at < sync_start`.
- `content_hash = SHA-256(name + description)` — маркер изменения _текстовых_ полей (того что идёт в embedding). Изменение цены или атрибутов **не** триггерит пересчёт embedding — экономит 90% OpenAI-вызовов при типичном паттерне.
- `last_seen_at` каждого присутствующего в batch item'а обновляется. При `syncMode=full` — всё что не попало в batch с `last_seen_at < sync_start` помечается `deleted_at = NOW()`. Soft-delete, не жёсткое удаление: дилер может искать снятый с продажи товар.
- **Аутентификация:** `Authorization: Bearer <SLOVO_INGEST_API_KEY>` — machine-to-machine, отдельный API key в env обеих сторон. `@UseGuards(ApiKeyGuard)` на endpoint. Не JWT — для service-to-service не нужен.
- **Rate limiting:** отдельный throttle на `/catalog/items/bulk` (например 10 batch/min — batch может содержать до 500 items).
- **Идемпотентность:** `@@unique([externalSource, externalId])` гарантирует идемпотентный upsert. Повторный batch с теми же данными = no-op (hash не меняется).

### Query — text

```mermaid
sequenceDiagram
    participant Client
    participant Slovo as slovo<br/>/catalog/search/text
    participant FW as Flowise<br/>catalog-embed-search chatflow
    participant Prisma as Prisma<br/>catalog_items

    Client->>Slovo: { q: "фильтр для жёсткой воды", limit: 5 }
    Slovo->>FW: POST /api/v1/prediction/<search-chatflow-id><br/>{ question: q, overrideConfig: { topK: 20 } }
    Note over FW: OpenAI embed(q) → pgvector cosine search
    FW-->>Slovo: ranked docs с metadata.catalogItemId
    Slovo->>Prisma: SELECT * WHERE id IN (catalogItemIds)
    Prisma-->>Slovo: full items + related services/components
    Slovo-->>Client: { products, services, cartridges, debug }
```

### Query — image (hybrid vision→text→embedding)

```mermaid
sequenceDiagram
    participant Client
    participant Slovo as slovo<br/>/catalog/search/image
    participant FWV as Flowise<br/>vision-describer chatflow
    participant FWE as Flowise<br/>catalog-embed-search chatflow
    participant Prisma as Prisma<br/>catalog_items

    Client->>Slovo: multipart image + { limit: 5 }
    Slovo->>FWV: POST /prediction/<vision-chatflow-id><br/>+ image upload (base64)
    FWV-->>Slovo: JSON { is_relevant, category, description_ru, features, confidence }

    alt is_relevant=false
        Slovo-->>Client: 400 + vision_output
    else is_relevant=true
        Slovo->>FWE: POST /prediction/<search-chatflow-id><br/>{ question: description_ru + features }
        FWE-->>Slovo: ranked docs
        Slovo->>Prisma: SELECT * WHERE id IN (...)
        Prisma-->>Slovo: items + related
        Slovo-->>Client: { products, services, cartridges, vision_output }
    end
```

**Почему "hybrid" через текстовый мост:** Vision → текст → embedding → поиск по каталогу embedding'ов. Не сравниваем image-embedding напрямую с text-embedding (разные семантические пространства). CLIP мог бы решить это напрямую, но не нужен при 500 товарах — text bridge проще и использует ту же embedding-модель что для text search.

**Почему Flowise делает два шага (embed + search) в одном prediction call:** Chatflow содержит OpenAI Embeddings + Postgres Vector Store + Retriever ноды связанные последовательно. Slovo шлёт query, Flowise всё внутри обрабатывает и возвращает готовый ranked список. Slovo остаётся **тонким клиентом** — один HTTP вызов на search, одна миграция для CatalogItem.

### Hybrid ranking (в slovo, после Flowise retrieve)

Flowise Retriever возвращает docs ranked только по **vector cosine similarity**. Дополнительный re-ranking (rang_for_app, category boost) делает **slovo** на стороне /catalog/search/* endpoint:

1. Flowise → top-20 docs by pure vector similarity
2. slovo JOIN с Prisma `catalog_items` по `metadata.catalogItemId` → достаёт `rangForApp`, `categoryPath`, `relatedServiceIds`, `relatedComponentIds`
3. slovo пересчитывает score:

```
final_score = 0.7 × vector_similarity_normalized   // от Flowise
            + 0.2 × rang_boost                      // coalesce(rangForApp, 0) / max_rang
            + 0.1 × category_boost                  // 0.1 если Vision.category совпадает с categoryPath substring
```

4. slovo → top-5/limit из пересорченного списка
5. slovo enrichment (related services/cartridges) → response клиенту

Веса 0.7 / 0.2 / 0.1 — начальные. Тюним по реальному UX. Все вычисления простые (JS map/sort на массиве 20 элементов) — не нужен SQL, не нужен pgvector напрямую в slovo.

### Enrichment payload — что отдаём клиенту

```json
{
  "products": [
    {
      "id": "...",
      "externalId": "moysklad-uuid",
      "name": "Аквафор DWM-101S",
      "description": "...",
      "salePriceKopecks": 4500000,
      "imageUrl": "...",
      "categoryPath": "Фильтры/Обратный осмос",
      "score": 0.87,
      "score_breakdown": {
        "vector": 0.82,
        "rang": 0.8,
        "category": 1.0
      }
    }
  ],
  "services_suggested": [
    {
      "id": "...",
      "name": "Монтаж фильтра под мойкой",
      "rateOfHours": 2,
      "source_product_ids": ["product-uuid-1"],   // из какого товара подтянули
      "salePriceKopecks": 500000
    }
  ],
  "cartridges_compatible": [
    {
      "id": "...",
      "name": "K1-07 префильтр",
      "salePriceKopecks": 70000,
      "lifespan_months": 6,
      "source_product_ids": ["product-uuid-1"]
    }
  ],
  "vision_output": { ... },                 // при image search — для прозрачности
  "debug": {
    "query_text": "...",                   // для text search или description_ru из vision
    "embedding_provider": "openai:text-embedding-3-small"
  }
}
```

Клиент получает **всё нужное за один запрос** — не ходит дополнительно за услугами и картриджами. Пользовательский UX: товар, сразу под ним кнопки "заказать монтаж" / "нужны картриджи".

---

## Схема данных

```prisma
model CatalogItem {
    id                 String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid

    // External identity — slovo не знает про MoySklad специфично.
    // externalSource = 'moysklad' | '1c' | 'manual' | любой другой feeder.
    // externalId — id в источнике истины (moyskladId для MoySklad).
    externalSource     String    @map("external_source") @db.VarChar(64)
    externalId         String    @map("external_id")     @db.VarChar(256)
    externalType       String    @map("external_type")   @db.VarChar(32)   // product | service | bundle | cartridge
    externalUpdatedAt  DateTime  @map("external_updated_at")

    // Базовые поля для отображения / фильтрации
    name               String    @db.VarChar(512)
    description        String?   @db.Text
    salePriceKopecks   Int?      @map("sale_price_kopecks")
    categoryPath       String?   @map("category_path")
    imageUrl           String?   @map("image_url")
    isVisible          Boolean   @default(true) @map("is_visible")
    rangForApp         Int?      @map("rang_for_app")  // ручной приоритет из MoySklad для ranking boost

    // Rich content — то что feeder собрал для embedding (для re-embed при смене
    // модели можно пересчитать не ходя в MoySklad)
    contentForEmbedding String   @map("content_for_embedding") @db.Text

    // Связи (ID list в JSONB) — для enrichment при search:
    //   { relatedServiceIds: ["..."], relatedComponentIds: ["..."] }
    // MVP без нормализации. Когда понадобится reverse-lookup ("какие товары
    // совместимы с этим картриджем") — выделим catalog_item_components table.
    attributes         Json?                                       // raw MoySklad attrs + relatedServiceIds + relatedComponentIds

    // Delta-sync маркеры
    contentHash        String    @map("content_hash") @db.Char(64) // SHA-256(contentForEmbedding)
    lastSeenAt         DateTime  @default(now()) @map("last_seen_at")
    deletedAt          DateTime? @map("deleted_at")

    createdAt          DateTime  @default(now()) @map("created_at")
    updatedAt          DateTime  @updatedAt @map("updated_at")

    // Embedding vector(1536) НЕ в этой таблице — живёт во Flowise-managed
    // таблице (обычно langchain_pg_embedding), с metadata.catalogItemId как
    // app-level FK. То же разделение что в ADR-006 для knowledge_chunks.
    // slovo про embeddings не знает, форвардит всё в Flowise.

    @@unique([externalSource, externalId])
    @@index([isVisible, deletedAt])
    @@index([externalType, isVisible, deletedAt])  // для image-search (фильтр по type)
    @@index([lastSeenAt])
    @@index([externalUpdatedAt])
    @@map("catalog_items")
}
```

**Ключевые решения:**
- `externalSource + externalId` — composite unique key, multi-source ready. `moysklad:abc-123` и `1c:def-456` одновременно живут в одной таблице.
- Отдельная таблица, не `knowledge_sources` — разные домены (user uploads vs org catalog), разные lifecycle (ad-hoc vs push-sync), разная авторизация (user-scoped vs read-all + ingest-key-protected).
- `externalType` не enum, а string — расширяется через код feeder'а без миграций БД (завтра добавим `sparepart`, `manual`, etc.).

### Контракт bulk ingest API

```typescript
POST /catalog/items/bulk
Authorization: Bearer <SLOVO_INGEST_API_KEY>
Content-Type: application/json

{
  syncMode: "partial" | "full",
  items: [
    {
      externalId: "a0b1c2d3-...",           // id у feeder'а (moyskladId для CRM)
      externalSource: "moysklad",           // дискриминатор источника
      externalType: "product",              // product | service | bundle | cartridge
      externalUpdatedAt: "2026-04-24T07:00:00Z",

      // Базовые поля для отображения / фильтрации
      name: "Аквафор DWM-101S",
      description: "Фильтр обратного осмоса с минерализатором",
      salePriceKopecks: 4500000,            // 45,000.00 ₽
      categoryPath: "Фильтры / Обратный осмос",
      imageUrl: "https://...",
      isVisible: true,
      rangForApp: 5,                        // ручной приоритет менеджера из MoySklad

      // Rich content для embedding — feeder уже собрал из name + description +
      // group.systemBundle.description + attributes. slovo эмбедит как есть.
      contentForEmbedding: "Товар: Аквафор DWM-101S\nОписание: ...\nКатегория: ...\nКонтекст группы: ...",

      // Связи — ID list, feeder собирает из parseServiceRefs / parseComponentRefs.
      // slovo хранит в JSONB attributes, при search-enrichment JOIN по этим id.
      relatedServiceIds: ["svc-uuid-1", "svc-uuid-2"],       // до 3 услуг
      relatedComponentIds: ["cart-uuid-1", "cart-uuid-2"],   // до 5 картриджей

      // Произвольные MoySklad-специфичные атрибуты — свободный JSONB для UI /
      // будущих фильтров (lifespan, warranty и т.п.).
      attributes: {
        lifespanMonths: 12,
        warrantyRequired: true
      }
    }
  ]
}

Response:
{
  received: 25,
  created: 3,
  updated_metadata_only: 18,   // contentHash совпал, embedding не пересчитан
  re_embedded: 4,              // contentHash поменялся или новая запись
  soft_deleted: 2,             // при syncMode=full
  errors: []
}
```

### Что за `contentHash` и когда пересчитывается embedding

`contentHash = SHA-256(contentForEmbedding)`. Это отличается от v1 плана (где хэш считался по `name + description`) — теперь **весь rich text** участвует в хэше.

**Impact:** если MoySklad обновил только цену товара (name/description/group.description не тронуты) — `contentForEmbedding` у feeder'а получится тот же → тот же hash → embedding не пересчитываем, экономим OpenAI-вызов.

Если изменилось хоть одно из полей которые feeder включает в rich text (например менеджер поправил описание группы) — hash меняется → слово пересчитывается. Это правильное поведение: группа влияет на все товары в ней, при её редактировании пересчитать embeddings — ок.

---

## Фазы реализации

| PR | Скоуп | Новая технология |
|---|---|---|
| **Phase 0 (✅ частично)** | В Flowise UI: (a) `vision-catalog-describer-v1` готов — валидирован на 6 тестах (PR1-3 сегодня); (b) **следующий шаг** — создать `catalog-embed-search` chatflow с OpenAI Embeddings + Postgres Vector Store + Retriever; (c) upsert + search на 3-5 тестовых товарах. | Flowise Postgres Vector Store, OpenAI Embeddings нода |
| **PR5** | `libs/llm/` — **тонкий HTTP-клиент `FlowiseClient`** к локальному Flowise API. Методы: `predictVision(imageBase64)`, `upsertCatalog(items)`, `searchCatalog(query, topK)`. Внутри — httpClient с retry + logging. NO Anthropic SDK, NO OpenAI SDK в slovo! | Thin HTTP client pattern |
| **PR6** | `CatalogItem` Prisma-модель (type discriminator product/service/cartridge/bundle) + миграция. `CatalogIngestController` + `POST /catalog/items/bulk` с `ApiKeyGuard`. Content_hash delta, soft-delete через last_seen_at. При изменении hash → вызов `flowiseClient.upsertCatalog(...)`. JSONB `attributes` для relatedServiceIds / relatedComponentIds. | ApiKey auth, idempotent bulk upsert |
| **PR7** | `/catalog/search/text` endpoint. slovo → `flowiseClient.searchCatalog(query, topK=20)` → Flowise возвращает ranked docs → slovo JOIN с Prisma по catalogItemId → hybrid re-rank (rang + category) → enrichment (related services/cartridges) → response. | Thin orchestration |
| **PR8** | `/catalog/search/image` — multipart image → `flowiseClient.predictVision(image)` → description → `flowiseClient.searchCatalog(description)` → тот же flow что PR7. Handling `is_relevant=false` → 400 с vision_output. Swagger + e2e с реальными фото. | End-to-end composition |
| **Вне slovo (параллельно)** | Feeder side — в `crm-aqua-kinetics-back`: сервис сборки `contentForEmbedding` из `name + description + group.pathName + systemBundle.description + attributes`. Extraction `relatedServiceIds` / `relatedComponentIds` через существующие `parseServiceRefs`/`parseComponentRefs`. Hook на cache invalidation → POST к slovo. Отдельный PR в crm репозитории. | crm → slovo HTTP integration |

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

1. **Flowise Vector Store под капотом.** Какую таблицу Flowise создаст в slovo БД? `langchain_pg_embedding` стандарт для LangChain's PGVector. Проверить на Phase 0 → зафиксировать в docs. Удаление старых embeddings при re-embed — Flowise сам? Или нужно вручную через raw SQL?
2. **Retriever-only chatflow без LLM.** Возможно в Flowise 3.1.2 retriever нода не даёт output без LLM ноды. Проверить в UI на Phase 0; если нельзя — использовать lightweight LLM (Haiku) только как passthrough для output formatting.
3. **Промпт v2 после Phase 0.** По результатам 6 тестов в Phase 0 промпт v1 хорош на 4/6 (2 проблемы с closed enum brand/category). Решение: open fields + post-processing canonicalization в slovo перед записью в БД.
4. **Cost budget.** Claude Vision $0.003/image + OpenAI embedding $0.003 / 500 товаров. 100 image searches в день = $0.30 + $0.0004. Копейки.
5. **Веса hybrid ranking (0.7 / 0.2 / 0.1)** — тюнить по UX. Возможна UI с кнопкой "сдвинуть приоритет в сторону популярных" (увеличить rang weight).
6. **Category canonicalization.** Как маппить Vision `category: "обратный осмос"` → MoySklad `categoryPath: "Фильтры/Обратный осмос/..."`? Lookup table с синонимами в slovo. 20-30 категорий — маленькая константа.

---

## Связи с другими фичами

- **knowledge-base** — те же принципы embedding + pgvector, но для другой сущности (user uploads). Catalog — отдельная модель.
- **water-analysis** (будет позже) — после распознавания параметров из бланка, рекомендует оборудование **через catalog search** — реюз пайплайна.
- **sme-cloning (video-to-artifact)** — аналогично, но vision для видео-кадров.
