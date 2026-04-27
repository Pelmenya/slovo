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

### Rich context сборка — в два шага

**Часть 1 — feeder шлёт "сырой" текст:**

`crm-aqua-kinetics-back` собирает текстовую часть (без картинок) из MoySklad структуры:
- CRM знает про System Bundle, `parseServiceRefs`, `parseComponentRefs`, `GroupService.getGroupBundle`
- slovo остаётся generic — не парсит чужие custom-attributes
- Новый feeder (1С в будущем) сам решает как собирать rich text

Что включает feeder в `contentForEmbedding` (text-part):
```
Товар: ${product.name}
${product.description ? 'Описание: ' + product.description : '(описание отсутствует)'}
Категория: ${group.pathName}
Контекст группы: ${systemBundle?.description ?? ''}
${relevant_attributes.map(a => a.name + ': ' + a.value).join('\n')}
Услуги для этого товара: ${relatedServicesNames.join(', ')}
Расходники (картриджи): ${relatedCartridgesNames.join(', ')}
```

**Описание часто отсутствует** в MoySklad (менеджеры не всегда его заполняют) — поэтому vision-extraction картинок становится главным источником семантики для embedding.

**Часть 2 — slovo обогащает через vision описания картинок:**

Feeder шлёт `imageUrls: string[]` для каждого товара. slovo:
1. Считает `imagesHash = SHA-256(sorted(urls).join('\n'))`.
2. Если hash совпадает с сохранённым в Prisma — берёт кэшированный `visionDescriptionsText`, не перегенерирует.
3. Если hash новый / изменился — параллельно прогоняет каждую картинку через `vision-describer` chatflow, aggregating descriptions, сохраняет в Prisma.
4. Вставляет в финальный embedding-text блок `Вид на фото: ${visionDescriptionsText}`.

Итоговый rich text (feeder-text + vision-text) → slovo отправляет в Flowise upsert → OpenAI embeddings + Postgres Vector Store.

**Почему vision cache важен:**

- MoySklad картинки меняются редко (новые модели раз в месяцы, фотографии ревизируются ещё реже)
- Re-generate vision при каждом sync = лишние $1.50 на каждые 500 товаров (даже если текст не изменился)
- Hash-based инвалидация: изменилась картинка → только для этого товара новый vision pass. Dev стоимость: первоначальный full sync ~$1.50, далее < $0.10 в неделю.

### Изображения — что где хранится

| Артефакт | Где живёт | Зачем |
|---|---|---|
| Бинарные файлы картинок | **MoySklad** (первоисточник) / CDN если есть | slovo их не скачивает, только URLs |
| `imageUrls: string[]` | Prisma `catalog_items.image_urls` JSONB | для отображения на фронте и расчёта imagesHash |
| `imagesHash` | Prisma `catalog_items.images_hash` CHAR(64) | инвалидация vision-cache |
| `visionDescriptionsText` | Prisma `catalog_items.vision_descriptions_text` TEXT | aggregate vision-описаний для embedding + диагностики |
| Embedding vector | Flowise-managed таблица в той же БД | semantic search |

Per-image vision descriptions не храним **отдельно** (выделенная таблица `catalog_item_images`) пока не понадобится показывать на фронте "по этой картинке AI сказал X". Сейчас aggregate-текст достаточен.

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
flowchart TB
    FEEDER[CRM feeder<br/>cache invalidation] -->|POST /catalog/items/bulk<br/>+ items: имя, описание, imageUrls, attrs| API[slovo<br/>CatalogIngestController]
    API --> VALIDATE[Валидация DTO + API key]

    VALIDATE --> IMGDIFF{imagesHash<br/>изменился?}
    IMGDIFF -->|да, или новая запись| FWVIS[Flowise vision-describer<br/>параллельно по всем imageUrls]
    FWVIS --> AGG[aggregate vision<br/>descriptions text]
    AGG --> RICH[Собираем rich text:<br/>feeder-text + vision-text]
    IMGDIFF -->|совпадает| CACHE[берём visionDescriptionsText<br/>из Prisma кэша]
    CACHE --> RICH

    RICH --> CHDIFF{contentHash<br/>изменился?}
    CHDIFF -->|да| FWUP[Flowise catalog-embed-search<br/>POST /vector/upsert]
    FWUP --> EMBED[OpenAI embedding 1536-dim]
    EMBED --> VSTORE[(Flowise-managed<br/>pgvector)]
    CHDIFF -->|нет| META_ONLY[UPDATE только метаданные]

    RICH --> META_DB[(Prisma catalog_items:<br/>base + imageUrls + imagesHash<br/>+ visionDescriptionsText + contentHash)]
    META_ONLY --> META_DB

    VALIDATE -->|syncMode=full| GC[SOFT-DELETE items<br/>+ DELETE vectors]
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
    isVisible          Boolean   @default(true) @map("is_visible")
    rangForApp         Int?      @map("rang_for_app")  // ручной приоритет из MoySklad для ranking boost

    // Картинки — массив URL из MoySklad. slovo их не скачивает, только URL.
    // Используется для отображения на фронте и для вычисления vision-cache.
    imageUrls              Json?   @map("image_urls")                 // string[]
    imagesHash             String? @map("images_hash") @db.Char(64)   // SHA-256(sorted urls) — ключ vision-cache
    visionDescriptionsText String? @map("vision_descriptions_text") @db.Text  // aggregate от всех картинок после vision-describer

    // Rich content для embedding — собирается в slovo как:
    //   feeder-text + "Вид на фото: " + visionDescriptionsText
    // Хранится для re-embed при смене модели или изменении rich text формата.
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
      description: "Фильтр обратного осмоса с минерализатором",   // может быть null / пустой
      salePriceKopecks: 4500000,            // 45,000.00 ₽
      categoryPath: "Фильтры / Обратный осмос",
      imageUrls: [                           // массив всех картинок товара из MoySklad
        "https://api.moysklad.ru/images/abc-1.jpg",
        "https://api.moysklad.ru/images/abc-2.jpg"
      ],
      isVisible: true,
      rangForApp: 5,                        // ручной приоритет менеджера из MoySklad

      // Rich content (text-part) для embedding — feeder собрал из name + description +
      // group.systemBundle.description + attributes + related services/cartridges names.
      // slovo дополнит блок "Вид на фото" из vision-cache и затем эмбедит.
      contentForEmbedding: "Товар: Аквафор DWM-101S\nОписание: ...\nКатегория: ...\nКонтекст группы: ...\nУслуги: Монтаж, Настройка\nРасходники: K1-07, K5-17",

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

## UX сценарии для фронта

Три основных сценария использования со стороны `prostor-app` / `crm-aqua-kinetics-front`. Все идут через `crm-aqua-kinetics-back` (он proxy'ит запросы к slovo и обогащает PII-специфичной логикой если нужно).

### Сценарий 1 — поиск товаров/услуг текстом

**Экран:** поисковая строка в prostor-app, пользователь (менеджер / инженер / клиент) пишет query на естественном языке.

```mermaid
sequenceDiagram
    participant UI as prostor-app (фронт)
    participant CRM as crm-aqua-kinetics-back
    participant S as slovo /catalog/search/text
    participant FW as Flowise catalog-embed-search
    participant DB as Prisma catalog_items

    UI->>CRM: POST /api/catalog/search<br/>{ q: "фильтр для жёсткой воды", limit: 10 }
    CRM->>S: POST /catalog/search/text<br/>+ SLOVO_API_KEY
    S->>FW: /prediction/<id> { question: q }
    FW-->>S: ranked docs [{ catalogItemId, score }]
    S->>DB: SELECT + enrichment (services, cartridges)
    DB-->>S: enriched items
    S-->>CRM: { products, services, cartridges }
    CRM->>CRM: фильтрация по правам пользователя, добавление PII-контекста (например userOrders)
    CRM-->>UI: JSON
    Note over UI: Рендер карточек товаров<br/>кнопки "заказать монтаж" / "купить картриджи"
```

**Что видит пользователь:**
- Карточка товара: картинка + название + цена + краткое описание
- Рядом badges: «монтаж 2,500 ₽», «сменные картриджи от 700 ₽» (из enrichment)
- Кнопка «В заказ» (добавляет товар + выбранные услуги/расходники)
- Badge AI-score (опционально для дебага менеджера)

### Сценарий 2 — поиск по фото

**Экран:** кнопка «📷 Подобрать по фото», клиент прислал фото в WhatsApp / Telegram, менеджер загружает в prostor-app.

```mermaid
sequenceDiagram
    participant UI as prostor-app
    participant CRM as crm-aqua-kinetics-back
    participant S as slovo /catalog/search/image
    participant FWV as Flowise vision-describer
    participant FWE as Flowise catalog-embed-search
    participant DB as Prisma

    UI->>CRM: multipart image + { limit: 5 }
    CRM->>S: /catalog/search/image (multipart forward)
    S->>FWV: /prediction/<vision-id> + image base64
    FWV-->>S: JSON { is_relevant, category, brand, description_ru, confidence }

    alt is_relevant = false (кот, документ)
        S-->>CRM: 400 + vision_output
        CRM-->>UI: "На фото не оборудование, уточните текстом"
    else is_relevant = true
        S->>FWE: /prediction/<search-id> { question: description_ru + features }
        FWE-->>S: ranked docs
        S->>DB: enrichment
        DB-->>S: items + services + cartridges
        S-->>CRM: { products, services, cartridges, vision_output }
        CRM-->>UI: + vision output для прозрачности
    end

    Note over UI: Шапка «AI распознал: обратный осмос Аквафор PRO»<br/>Ниже — карточки товаров как в сценарии 1
```

**Что видит пользователь:**
- В шапке результата: badge «AI распознал: {category}, бренд {brand}, уверенность {confidence}»
- Кнопка «Уточнить» (открывает text search с предзаполненным описанием)
- Список карточек товаров (тот же UX что в сценарии 1)

### Сценарий 3 — ассистент по проблемам с водой (будущее, post-PR8)

**Экран:** чат-бот в prostor-app — клиент описывает проблему естественным языком.

```mermaid
sequenceDiagram
    participant UI as prostor-app чат
    participant CRM as crm-aqua-kinetics-back
    participant S as slovo /advice/water-problem
    participant LLM as Flowise claude-haiku-classifier
    participant FW as Flowise catalog-embed-search

    UI->>CRM: "У меня жёлтая вода из под крана"
    CRM->>S: /advice/water-problem { message }
    S->>LLM: классифицирует проблему → "железо"
    LLM-->>S: { problems: ["iron"], severity: "medium" }
    S->>FW: search "обезжелезиватель для дома"
    FW-->>S: ranked docs
    S-->>CRM: { diagnosis, products, cross_sell: water_analysis_link }
    CRM-->>UI: чат-ответ с карточками товаров + предложение заказать анализ воды
```

Это уже **агентский flow**, появится в PR после PR8 когда будет готова catalog-search база.

### Response DTO — что получает фронт

```typescript
// GET-like ответ на все сценарии поиска
type CatalogSearchResponse = {
    products: Array<{
        id: string                   // slovo CatalogItem.id
        externalId: string            // MoySklad uuid — для cross-reference с CRM
        name: string
        description: string | null
        imageUrls: string[]           // 0..N, фронт показывает первую или слайдер
        salePriceKopecks: number | null
        categoryPath: string | null
        score: number                 // final_score из hybrid ranking
        scoreBreakdown?: {            // только в dev для отладки
            vector: number
            rang: number
            category: number
        }
    }>
    services: Array<{
        id: string
        name: string
        rateOfHours: number | null
        salePriceKopecks: number | null
        sourceProductIds: string[]    // из каких товаров подтянули (для UI группировки)
    }>
    cartridges: Array<{
        id: string
        name: string
        salePriceKopecks: number | null
        lifespanMonths: number | null
        sourceProductIds: string[]
    }>
    visionOutput?: {                  // только для image search
        isRelevant: boolean
        category: string | null
        brand: string | null
        description: string
        confidence: 'high' | 'medium' | 'low'
    }
    debug?: {                         // только в dev
        queryText: string
        embeddingProvider: string
    }
}
```

Фронт получает **всё нужное одним запросом** — больше не делает запросы за услугами или картриджами. Всё уже enrichment'ом подтянуто.

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

## Стоимость — две разные категории

Важно различать два класса costs которые работают по разной логике.

### 1. Ingest cost (катaлог) — разово + инкрементально

Embedding каталога делается **один раз** при первом full sync, далее обновляется **только для изменившихся товаров** (по imagesHash + contentHash). Это «холодный» индекс который не пересчитывается при поисковых запросах.

| Операция | Единица | Цена | Частота | Итого |
|---|---|---|---|---|
| **Первый full ingest** 500 товаров с 3 картинками в среднем | 1500 Vision-пассов + 500 embedding | Vision $0.003 × 1500 + Embed $0.0000004 × 500 | разово | **~$4.50** |
| **Incremental update** (5-10 товаров поменяли описания/картинки в день) | vision только для новых картинок + embedding | ~$0.01-0.05/день | ежедневно | **$0.30-1.50/мес** |

### 2. Query cost (runtime) — на каждый запрос пользователя

**Каждый** user query (текст или картинка) превращается в embedding **в момент запроса** — это runtime cost, а не разовый. **Сам поиск в pgvector — БЕСПЛАТЕН** (cosine similarity = обычный SQL без LLM).

| Операция | Что считается на каждый запрос | Цена/запрос | Latency |
|---|---|---|---|
| **Text search** | 1 OpenAI embedding (~20 tokens query) | **~$0.0000004** | ~200ms |
| **Image search** | 1 Claude Vision (~$0.003) + 1 OpenAI embedding (~$0.0000004) | **~$0.003** | ~3-5s (Vision доминирует) |
| **Cosine search в pgvector** | 0 LLM-вызовов, обычный SQL | **$0** | ~10-30ms |

#### Реальные цифры месячно (наш масштаб):

| Сценарий | Запросов/день | Cost/мес |
|---|---|---|
| 100 text-search/день | 100 | **$0.001** |
| 50 image-search/день | 50 | **$4.50** |
| ИТОГО | | **~$4.50/мес** на queries |

#### Что важно для понимания

- **Каждый user query — отдельный embedding pass.** Если 100 пользователей одну и ту же фотку грузят по очереди — это 100 Vision-вызовов (если без кэша query-стороны).
- **Сам поиск (top-K cosine)** — это математика над уже сохранёнными векторами, **не LLM-вызов**. 1000 одновременных searches в pgvector — это просто 1000 SQL-запросов с использованием HNSW-индекса, миллисекунды.
- **Каталог** между запросами **не пересчитывается** — индекс холодный, query — горячий.

### Итого месячно при текущем масштабе

| Категория | Сумма |
|---|---|
| Первый ingest (разово при старте) | $4.50 |
| Инкрементальный ingest | $0.30-1.50/мес |
| Text searches (100/день) | $0.001/мес |
| Image searches (50/день) | $4.50/мес |
| **ИТОГО в месяц** | **~$5-10/мес** |

На пет-масштабе **не повод для беспокойства**. Серьёзная оптимизация cost-side понадобится только при росте на порядок (5K товаров, 1000+ image searches/день).

---

## Стратегии оптимизации query cost (на будущее)

Когда масштаб вырастет — есть три рельсы для снижения runtime cost.

### Стратегия 1 — кэширование результатов поиска по hash query

Если **одинаковая** картинка / текст приходит повторно — отдаём кэшированный top-K:

```
client → slovo /catalog/search/image
    → SHA-256(image bytes)
    → Redis lookup [hash → top-K results]
    → если есть в кэше → возврат за 5ms, $0
    → если нет → vision + embedding + search → ответ + cache на 24ч
```

**Польза:** в B2B-сценариях (менеджер пересылает другому менеджеру типовое фото) — повторные запросы 0$.
**Стоимость реализации:** 30-50 строк в slovo + Redis (уже есть в стеке).
**Когда выгодно:** когда видим что > 20% запросов повторяющиеся.
**Не оптимизирует:** уникальные картинки клиентов (которые в реальности будут доминировать).

### Стратегия 2 — Ollama embeddings локально

Заменить OpenAI text-embedding-3-small на локальную `bge-m3` или `multilingual-e5-large` через Ollama (доступен в инфре `water-analysis-parser` стека на RTX 4070 Ti).

| | OpenAI small | Ollama bge-m3 |
|---|---|---|
| Embed cost | $0.0000004/query | **$0** |
| Latency | ~200ms (через сеть) | ~50ms (локально) |
| Качество RU | хорошо | хорошо |
| Нагрузка | 0% (cloud) | GPU 16GB утилизируется |

**Замена в Flowise:** одна нода в UI, slovo не трогаем. Качество практически идентично на RU/EN.
**Когда выгодно:** объём text searches > 10K/день, или нужна низкая latency, или privacy.

### Стратегия 3 — CLIP вместо Claude Vision для image search

**True image-to-image search** через мультимодальную модель CLIP / SigLIP — embed-ит картинку и текст в одно векторное пространство:

```
картинка пользователя → CLIP image embedding (1 шаг, $0)
                     ↓
                pgvector cosine с CLIP image embeddings товаров
```

**Trade-offs:**
- Cost: **$0 при локальном CLIP** (Ollama или transformers на GPU)
- Latency: ~100ms вместо 3-5s для Claude Vision
- Качество: **хуже** распознаёт конкретный бренд / модель / надписи на упаковке (CLIP — общий matcher, не специалист в водоочистке)
- При ingest каталога надо считать **дополнительные** CLIP image embeddings к товарам — две колонки vector в БД (text + clip_image)

**Когда выгодно:** image searches > 1000/день, и качество "общая визуальная похожесть" приемлемо для UX (или его дополняет точный бренд из CRM-каталога через other signals).

### Hybrid pgvector + PostgreSQL FTS — для лексической точности

Параллельно с semantic search можно делать **lexical match** через PostgreSQL `tsvector`:

```sql
WHERE to_tsvector('russian', name || ' ' || description) @@ websearch_to_tsquery('russian', $1)
```

**Польза:** точный поиск по бренду / артикулу / номеру модели (`"Аквафор PRO V500"` — embedding может промахнуться, FTS — нет).
**Cost:** $0 (это обычный SQL с GIN индексом).
**Реализация:** в slovo через raw query, объединяем с pgvector top-K через reciprocal rank fusion.
**Когда выгодно:** когда semantic-only начнёт промахиваться на artikul-like запросах. Это **штатное** дополнение к pgvector в любых serious search системах.

### Когда что включать

```
Этап 0 — текущий план (PR5-PR8)
  → OpenAI embeddings + Claude Vision + pgvector
  → cost: $5-10/мес

Этап 1 — рост до 10K+ text searches/день
  → добавить Redis кэш по hash query
  → опционально переключить text-embed на Ollama
  → cost остаётся в районе $5-15/мес даже при росте 10x

Этап 2 — рост до 1K+ image searches/день
  → добавить Redis кэш + посмотреть % повторов
  → если повторов много (>30%) — кэша достаточно
  → если уникальные картинки доминируют → CLIP параллельно с Vision (дешёвый CLIP-pass для top-50, далее опционально Vision для top-10 когда нужны brand/model)

Этап 3 — много lexical queries (артикулы, бренды)
  → добавить FTS hybrid в pgvector search
  → 0 incremental cost
```

Не делаем эти оптимизации **превентивно** — реактивно по метрикам реального usage.

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
