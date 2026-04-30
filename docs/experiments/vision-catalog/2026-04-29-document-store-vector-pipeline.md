# Эксперимент: Document Store (Vector) pipeline для catalog search

> **Дата:** 2026-04-29
> **Статус:** 🟡 в работе
> **Связано с:** ADR-007, `docs/features/vision-catalog-search.md`, `docs/guides/flowise-vs-nestjs.md` (эксперименты D, E)

---

## Гипотеза

Document Store (Vector) в Flowise 3.1.2:

1. Может query'ить **существующую** Postgres-таблицу `catalog_chunks` (наполненную ранее через Chatflow upsert) → вернуть тот же top-K что Chatflow + Haiku, но **без LLM-вызова и hallucination**.
2. Может **upsert'ить** документы напрямую через `/api/v1/document-store/upsert/<id>` без UI Document Loader (чтобы slovo `apps/worker` мог пушить snapshot из MinIO без файлов).
3. Cost search ↓ с $0.0001/query (Chatflow + Haiku) до $0.0000004/query (только query embedding).

## Setup

**Версии:**
- Flowise: 3.1.2 (image `flowiseai/flowise:3.1.2`)
- pgvector/pgvector:0.8.2-pg18-trixie
- @aws-sdk/client-s3 (slovo-side, для будущего)
- Node 24.15 LTS на хосте

**Существующее состояние БД:**
- Таблица `catalog_chunks` уже создана при Phase 0 Chatflow upsert
- Schema: `id (uuid PK) / pageContent (text) / metadata (jsonb) / embedding (vector 1536-dim)`
- 4 чанка из 3 sample items (sample-3items.json):
  - 7194736b-... — Смеситель C125 (2 чанка после splitter, длинный текст)
  - 9d8c1dc4-... — Смеситель C126 (1 чанк)
  - a2325cf6-... — Смеситель 82138С (1 чанк)

**Существующие credentials в Flowise:**
- `openai-dev` (OpenAI API key)
- `postgres-slovo-dev` (slovo Postgres user/password)
- `anthropic-dev` (Claude API key, для vision-describer chatflow)

**Chatflow для сравнения:**
- ID: `2e016504-1e83-498f-b3b5-4baba11db5dd`
- Name: `catalog-embed-search`
- Endpoint: `POST /api/v1/prediction/<id>`

## Шаги

> Заполняется по ходу эксперимента — точные клики, параметры, ответы.

### Шаг 1 — создать Document Store (2026-04-29 ~11:38)

**Действия (выполнены):**

1. ✅ Flowise UI → левое меню → Document Stores
2. ✅ + Add New → **в нашей версии Flowise 3.1.2 в самом сайдбаре только один тип «Document Store»**, варианта `Document Store (Vector)` нет. Этот вариант появляется только как **нода в Chatflow palette**, не как отдельная сущность в Document Stores admin section.
3. ✅ Name: `catalog-aquaphor`, Description: `Каталог Аквафор для semantic search через slovo`
4. ⚠️ Конфигурация **embedding + vectorstore** на store-уровне в UI **недоступна напрямую** — только через "+ Add Document Loader" workflow. После создания Document Store показывает статус `EMPTY` и единственное действие "+ Add Document Loader".

**Результат:**
- Store создан, виден в админке, но статус `EMPTY`.
- More Actions dropdown: View & Edit Chunks (greyed), Upsert All Chunks (greyed), **Retrieval Query (greyed)**, Refresh, Delete. Все greyed — активируются после первого Process.
- storeId TBD (через UI URL получим после next step).

**Вывод по UI vs Source code:**

В исходнике (`services/documentstore/index.js:1170 queryVectorStore`) колонки `embeddingConfig` и `vectorStoreConfig` сохраняются в `DocumentStore` entity. Они заполняются **в момент первого Process** через Document Loader workflow, не до этого. То есть UI **не даёт** сконфигурить store без хотя бы одного loader'а.

**Альтернативы для будущих экспериментов:**
- Сконфигурить через REST API напрямую: `PUT /api/v1/document-store/store/<id>` с `embeddingConfig` + `vectorStoreConfig` — обходит UI ограничение.
- Или принять UI-flow и пройти через "+ Add Document Loader" → S3 File / Plain Text → embedding+vectorstore inputs внутри loader → Process.

### Шаг 2 — query API smoke-test

**Цель:** дёрнуть `/api/v1/document-store/vectorstore/query` с тем же запросом что использовали в Chatflow тесте, сравнить ответ.

**Запрос:**

```bash
curl -s --noproxy '*' -X POST \
  http://127.0.0.1:3130/api/v1/document-store/vectorstore/query \
  -H "Content-Type: application/json" \
  --data-binary @query.json
```

`query.json`:
```json
{ "storeId": "<storeId>", "query": "какой смеситель есть для кухни" }
```

**Ожидание:**

```json
{
  "timeTaken": ~150,
  "docs": [
    { "pageContent": "Название: Смеситель кухонный модель ...", "metadata": { "externalId": "..." }, "id": "..." }
  ]
}
```

Top-K должен быть тот же что в Chatflow ответе:
1. 82138С (a2325cf6)
2. С126 (9d8c1dc4)
3. С125 chunk-1 (7194736b)
4. С125 chunk-2 (7194736b, Монтажные услуги)

**Реальный ответ:**

_ToDo: вставить полный JSON-ответ_

**Сравнение vs Chatflow + Haiku:**

| Метрика | Chatflow | Document Store |
|---|---|---|
| timeTaken | ~1500ms (с Haiku completion) | _ToDo_ |
| docs возвращены | 4 (через `sourceDocuments[]`) | _ToDo_ |
| ranking совпал? | да | _ToDo_ |
| LLM вызовов | 1 (Haiku) | _ToDo_ |

### Шаг 3 — upsert API без UI loader'а

**Цель:** проверить что slovo сможет пушить документы через API без файлового аплоада.

**Запрос:**

```bash
curl -s --noproxy '*' -X POST \
  http://127.0.0.1:3130/api/v1/document-store/upsert/<storeId> \
  -H "Content-Type: application/json" \
  --data-binary @upsert.json
```

`upsert.json` (3 sample items в Document Store-формат):

_ToDo: подобрать правильную форму payload — в Flowise upsert API ждёт specific shape_

**Реальный ответ:**

_ToDo: вставить ответ + проверить count в БД_

### Шаг 4 — проверить что не сломалась существующая Chatflow

**Цель:** убедиться что когда Document Store query'ит ту же таблицу что Chatflow апсёртит, нет конфликтов schema/данных.

**Действия:**

1. _ToDo: дёрнуть Chatflow prediction после Document Store upsert — ranking тот же?_
2. _ToDo: посмотреть в БД count + сравнить metadata формат_

## Анализ

_ToDo: заполнить после прогона._

Ключевые вопросы:
- [ ] Document Store создал ли свою служебную таблицу (`document_store_file_chunk` или подобную)?
- [ ] Через query API возвращается ли `chunkNo: -1` для документов добавленных вне Document Store (по коду — должно быть так)?
- [ ] Можно ли смешивать upsert через Chatflow и query через Document Store на одной таблице?
- [ ] Какой формат payload у `/document-store/upsert/<id>` — multipart или JSON?
- [ ] Поддерживает ли upsert API передачу documents inline (без file)?

## Архитектурное влияние

_ToDo: после результатов — какие правки в:_

- ADR-007 (упомянуть Document Store как ingest-вариант через API)
- vision-catalog-search.md (PR5/PR6 переписать под Document Store endpoint'ы)
- flowise-vs-nestjs.md (расширить секцию E с практикой)
- ~`memory/`~ (зафиксировать что Flowise имеет 2 подсистемы)

## Открытые вопросы

- [ ] Что произойдёт если slovo upsert через Document Store, а потом удалит item из CRM-snapshot — Document Store умеет soft-delete по metadata?
- [ ] Нужна ли отдельная таблица для catalog vs обычная общая для всех Document Stores в slovo-postgres?
- [ ] Будет ли Document Store создавать HNSW-индекс автоматически или это всё ещё нужно вручную?
- [ ] Что произойдёт при concurrent upsert + query — Postgres транзакции / lock-free reads?

## Развилка по ingest (S3 Loader Flowise vs slovo-orchestration)

**Открытие в ходе эксперимента:** Flowise S3 File Loader (`flowise-components/nodes/documentloaders/S3File`) **НЕ поддерживает custom endpoint** для MinIO. В `S3ClientConfig` передаётся только `region` и `credentials`, без `endpoint` и `forcePathStyle: true` (требуется для MinIO).

**Три варианта обхода для production ingest:**

### A. AWS SDK env-переменные на Flowise-контейнере

`@aws-sdk/client-s3` с 2024 читает `AWS_ENDPOINT_URL_S3` и `AWS_S3_FORCE_PATH_STYLE`. Дополнить `docker-compose.infra.yml`:

```yaml
flowise:
  environment:
    AWS_ENDPOINT_URL_S3: http://slovo-minio:9000
    AWS_S3_FORCE_PATH_STYLE: "true"
```

**Плюсы:** zero code, через UI настраивается S3 File Loader → bucket + key + AWS Credential.
**Минусы:** требует рестарта Flowise (cache-инвалидация инфры). Если в будущем slovo использует другой managed S3 — env конфликтует.
**Проверить:** действительно ли Flowise S3Client при `endpoint` из env применит `forcePathStyle`. Нужен smoke-тест.

### B. Custom Document Loader (forked node)

В Flowise есть нода **Custom Document Loader** — пользовательская JS-логика. Можно написать MinIO-aware loader, явно передающий `endpoint`/`forcePathStyle` в `S3Client`.

**Плюсы:** полный контроль, не ломает другие S3-логики.
**Минусы:** дополнительный код в Flowise, требует поддержки.

### C. Slovo сам читает + POST в Document Store API

Slovo `apps/worker` через `libs/storage` (уже настроенный для MinIO) читает `latest.json`, парсит items, POST'ит в `/api/v1/document-store/upsert/<id>`.

**Плюсы:**
- Slovo остаётся тонким HTTP-клиентом (читает S3 + POST'ит JSON).
- Flowise всё равно делает chunking + embedding (сохраняем разделение ответственности).
- vision_cache lookup происходит на стороне slovo до отправки в Flowise — не дублируем Vision вызовы.
- Проще debug — логи у нас, не в Flowise stdout.

**Минусы:**
- Чуть больше кода в slovo (но мы и так планировали `CatalogSyncService`).
- Нужен парсер snapshot.json в slovo (тривиально через `JSON.parse`).

**Рекомендация для PR6:** **C** (slovo orchestrates). Это совместимо с тем что мы уже описали в `vision-catalog-search.md` и ADR-007. Варианты A/B остаются как fallback если в будущем хотим перенести orchestration в Flowise.

---

## Лог итераций

> Хронологический журнал — каждая попытка с timestamp.

### 11:30 (примерно) — старт эксперимента

- Папка `docs/experiments/vision-catalog/` создана.
- Скелет lab journal записан.
- Готов к Шагу 1.

### 11:38 — Document Store `catalog-aquaphor` создан

- Status: `EMPTY`, ждёт +Add Document Loader.
- 5 опций в More Actions все greyed (требуется первый Process для активации).

### 11:43 — путаница с типами «Document Store» vs «Document Store (Vector)»

Разобрались: `Document Store (Vector)` это **нода в Chatflow palette** для использования существующего store'а внутри chain'а, не отдельная сущность в админ-секции. В Document Stores admin section только один тип.

### 12:00 — поправка docker-compose.infra.yml для MinIO S3 Loader

Открытие из исходника `flowise-components/nodes/documentloaders/S3File/S3File.ts:584`:

```typescript
const s3Config: S3ClientConfig = {
    region,
    credentials
}  // ← нет endpoint/forcePathStyle для MinIO
```

S3 File Loader не передаёт endpoint/forcePathStyle в S3Client. **Workaround**: AWS SDK env-fallback в Flowise-контейнере:

```yaml
flowise:
  environment:
    AWS_ENDPOINT_URL_S3: http://slovo-minio:9000
    AWS_S3_FORCE_PATH_STYLE: "true"
    AWS_DEFAULT_REGION: us-east-1
```

Контейнер пересоздан через `docker compose up -d flowise`. Env переменные подтверждены `docker exec slovo-flowise env`. Закоммичено в `docker-compose.infra.yml` (commit b694468).

### 12:30 — переосмысление архитектуры → Level 1 (минимум кода)

В ходе обсуждения с разработчиком — отказались от двухуровневого dedup (vision_cache + contentHash) ради минимума кода в slovo. Новый план:

| Компонент | Уровень кода |
|---|---|
| Flowise Document Store (S3 Loader → JSON → Embed → Postgres) | UI-only |
| Flowise vision-catalog-describer-v1 (image → JSON description) | UI-only, уже есть |
| slovo `apps/worker/catalog-refresh` | ~5 LOC (RMQ → POST refresh) |
| slovo `apps/api/catalog/search` | ~50 LOC (controller + service + thin Flowise client) |
| Prisma `CatalogItem`, `VisionCache` | ❌ удалены из плана |
| contentHash dedup | ❌ удалён, полный re-embed на каждый refresh |

**Cost Level 1:** ~$5/мес (тот же что с dedup, потому что 155 items × text embedding это копейки, а Vision только на user-image search runtime).

**Trade-off:** на 1000+ товаров когда Vision-обогащение каталога reduces cost vs полный re-embed — Level 1 надо будет апгрейдить до Level 2/3. На 155 items не имеет значения.

### 12:45 — расширили metadata extraction плана

Чтобы Flowise Document Store отдавал в search response **достаточно данных для UI**, в Json Loader нужно прокинуть в `Additional Metadata` все поля из `TBulkIngestItem` через jsonpointer (с leading slash):

```
externalId       /externalId
externalType     /externalType
name             /name
description      /description
salePriceKopecks /salePriceKopecks
categoryPath     /categoryPath
imageUrls        /imageUrls
rangForApp       /rangForApp
relatedServices  /relatedServices
relatedComponents /relatedComponents
```

`jsonpointer.get()` возвращает значения любого типа (массивы, объекты, числа), пройдено в `Json.ts:181`. metadata jsonb в pgvector станет толстый (~5 KB на item), но 155 × 5 KB = 0.75 MB, ничтожно.

Slovo НЕ нужна Prisma `CatalogItem` таблица — все enrichment-данные приходят от Flowise через metadata.

Картинки в API response — slovo генерирует presigned URLs из S3-keys на лету (`s3.getSignedUrl(key, expiresIn: 3600)`).

### 13:00 — image search smoke test (vision-describer + C125)

**Цель:** проверить что vision-catalog-describer-v1 chatflow корректно описывает фото товара из MinIO.

**Шаги:**

1. Скачали из MinIO: `catalogs/aquaphor/images/7194736b-19d6-11e7-7a31-d0fd00056ba7/1d6e7eefa7330da579a9680c4478a2ca0838cf9bd37201ea9fd4cd6331d9805a.png` (138 KB, смеситель C125 первая картинка)
2. Закодировали в base64 (185 KB строкой)
3. Сформировали payload:
   ```json
   {
     "question": "Опиши товар на фото — категория, бренд, модель, состояние",
     "uploads": [{
       "data": "data:image/png;base64,iVBORw0KGgo...",
       "type": "file",
       "name": "c125.png",
       "mime": "image/png"
     }]
   }
   ```
4. POST `/api/v1/prediction/991f9b70-fdae-47cf-bc20-4f3261034216` (chatflow ID `vision-catalog-describer-v1`).

**Результат:**

```json
{
  "is_relevant": true,
  "category": "прочее",
  "brand": "неизвестно",
  "model_hint": null,
  "features": [
    "двухвентильный кран",
    "высокий изогнутый излив",
    "хромированное покрытие",
    "два рычага управления",
    "кран для питьевой воды"
  ],
  "condition": "новый в упаковке",
  "description_ru": "Кран смеситель для питьевой воды с двумя рычагами и высоким изогнутым изливом, хромированный, используется в системах водоочистки обратного осмоса как кран чистой воды на мойку.",
  "confidence": "high"
}
```

**Анализ:**

- ✅ `description_ru` богат ключевыми словами для text-search: «кран смеситель», «питьевой воды», «обратного осмоса», «под мойку».
- ✅ `features` — отдельные термины полезны для filter post-processing.
- ✅ `confidence: high` — Vision уверен.
- ⚠️ `category: прочее` — closed enum классификации Vision не справляется на изоляции (нет «смесителей» в его enum'е). Это известная проблема промпта v1 (см. Open question #3 в `vision-catalog-search.md`).
- ⚠️ `brand: неизвестно`, `model_hint: null` — на изолированной картинке без упаковки/логотипа. Ожидаемо.

**Вывод:** для query через text-bridge `description_ru` достаточно. Search по нему должен match'нуть смеситель C125 / C126 / 82138C из catalog_chunks.

**Следующий шаг:** дождаться upsert от user'а в catalog-embed-search Chatflow → дёрнуть search через Conversational Retrieval QA Chain с `description_ru` как question → проверить что C125 найден в top-K.

### Сохранённые артефакты

- `C:\Users\Diamond\Desktop\slovo\sample-3items.json` — 3 товара из CRM-snapshot для UI smoke-теста (untracked, в .gitignore не добавлен — обсудить или fixtures/)
- `C:\Users\Diamond\Desktop\slovo\c125-b64.txt` — base64 картинки C125 (185 KB), для повтора vision-теста
- `C:\Users\Diamond\Desktop\slovo\vision-req.json` — payload для prediction API (185 KB)

---

## День 2 — 2026-04-30: закрытие Phase 0

### 11:00 — Шаг 1: Upsert sample-3items в catalog-embed-search

User в Flowise UI нажал **Upsert Vector Database** на Chatflow `catalog-embed-search`. Json File loader там настроен с `sample-3items.json`. Через ~3 секунды зелёный тост `Added: 4`.

```bash
docker exec slovo-postgres psql -U slovo -d slovo -c "SELECT count(*) FROM catalog_chunks;"
# count = 4
```

### 11:05 — Шаг 1: vision-describer на C125 image

Тот же payload что в 13:00 (день 1). Результат повторяемый — `description_ru: "Кран смеситель для питьевой воды с двумя рычагами и высоким изогнутым изливом, хромированный, используется в системах водоочистки обратного осмоса для подачи фильтрованной воды."`

### 11:10 — Шаг 1: image-search end-to-end через Chatflow

Сформировали `query-c125.json`:
```json
{ "question": "Кран смеситель для питьевой воды с двумя рычагами и высоким изогнутым изливом, хромированный, используется в системах водоочистки обратного осмоса для подачи фильтрованной воды." }
```

POST `/api/v1/prediction/2e016504-1e83-498f-b3b5-4baba11db5dd` (catalog-embed-search). **timeTaken: 4865 ms**.

**Retrieval ✅:**

| Rank | externalId | Item |
|---|---|---|
| 1 | `7194736b-19d6-11e7-7a31-d0fd00056ba7` | **C125** (тот самый) |
| 2 | `a2325cf6-3bb6-11ec-0a80-051b0008a602` | 82138С |
| 3 | `9d8c1dc4-19d6-11e7-7a31-d0fd0005747a` | C126 |
| 4 | `7194736b-...` (chunk-2) | C125 — Монтажные услуги |

Vector search по `description_ru` точно нашёл C125 — фотография определилась корректно.

**Generation ⚠️:** Conversational Retrieval QA Chain (Haiku) ответил *«Хмм, я не уверен. В предоставленной информации нет описания крана-смесителя с двумя рычагами и высоким изогнутым изливом...»*. Промпт строгий — отвечает только из контекста, а в чанках нет визуальных характеристик («хромированный», «изогнутый излив») — они только в нашем query от vision'а.

**Вывод:** retrieval работает идеально, но LLM-overlay в QA Chain убивает UX потому что текст товаров не содержит визуальных терминов из vision-описания. **Прямое доказательство необходимости Document Store query API без LLM** — нам нужны `docs[]` напрямую, без интерпретации.

### 11:30 — Шаг 2: попытка через UI зашла в тупик

User создал AWS Credential `minio-slovo-datasets` в Flowise UI, добавил S3 File Loader в Document Store `catalog-aquaphor` со всеми 10 metadata pointers и Recursive Splitter (1000/200). На **Process** упало:

```
Please fill in the following mandatory fields: Unstructured API URL
```

Поле скрыто через `show: { fileProcessingMethod: 'unstructured' }` (см. `S3File.ts:175`), но required-чек в UI игнорирует `show`. Default `optional` зависит от env (`optional: !!process.env.UNSTRUCTURED_API_URL`).

**Workaround:** добавили `UNSTRUCTURED_API_URL=http://localhost:8000/general/v0/general` в `docker-compose.infra.yml` → флаг `optional` стал `true` → required снимается. Сам URL никогда не используется при Built In Loaders. Закоммичено в `docker-compose.infra.yml`.

После рестарта Flowise — состояние формы потерялось (Document Store loader конфиг сохраняется в sqlite **только после первого успешного Process**, до этого state живёт в браузере). User заполнил повторно — но теперь вылез **второй блокер**: F5 / refresh снова сбрасывает форму. UI цикл оказался непродуктивным.

### 11:45 — Шаг 2: переключаемся на REST API

User создал API key через UI Credentials → API Keys (`+ Create Key`), скопировал значение. Все Document Store endpoint'ы под `checkPermission()` принимают `Authorization: Bearer <apiKey>`.

**Reproducible recipe** (последующие refresh-сценарии и slovo `apps/worker` смогут использовать тот же путь):

```bash
KEY="<flowise-api-key>"
STORE_ID="aec6b741-8610-4f98-9f5c-bc829dc41a96"   # GET /document-store/store
```

Полученные id:

| Сущность | id |
|---|---|
| Document Store `catalog-aquaphor` | `aec6b741-8610-4f98-9f5c-bc829dc41a96` |
| Credential `minio-slovo-datasets` (awsApi) | `56f648d8-36bc-4885-a3cf-f79f796e7674` |
| Credential `OpenAI API` (openAIApi) | `50796497-27d1-4d45-8e59-fd2420e9c76e` |
| Credential `postgres-slovo-dev` (PostgresApi) | `65d7f839-141d-4333-a3dd-65c8d08d3b51` |

### 11:50 — Шаг 2: loader/save → 200 OK

POST `/api/v1/document-store/loader/save` с payload (`loader-save.json`):

```json
{
  "storeId": "aec6b741-...",
  "loaderId": "S3",
  "loaderName": "S3",
  "credential": "56f648d8-...",
  "loaderConfig": {
    "credential": "56f648d8-...",
    "bucketName": "slovo-datasets",
    "keyName": "catalogs/aquaphor/latest.json",
    "region": "us-east-1",
    "fileProcessingMethod": "builtIn",
    "metadata": "{\"externalId\":\"/externalId\",...10 pairs...}",
    "omitMetadataKeys": ""
  },
  "splitterId": "recursiveCharacterTextSplitter",
  "splitterName": "Recursive Character Text Splitter",
  "splitterConfig": { "chunkSize": 1000, "chunkOverlap": 200 }
}
```

Loader id: `c8fbef8f-0709-46bb-ad4c-72ef67281d3f`, status `SYNCING`.

### 12:00 — processLoader: каскад блокеров MinIO virtual-hosted style

POST `/api/v1/document-store/loader/process/<loaderId>` упал три раза подряд:

**Блокер 1 — DNS:** `getaddrinfo ENOTFOUND slovo-datasets.slovo-minio`. AWS SDK v3 по умолчанию строит **virtual-hosted-style** URL (`<bucket>.<host>`), Flowise S3File не передаёт `forcePathStyle: true`. Env `AWS_S3_FORCE_PATH_STYLE` оказался **не стандартный AWS SDK** — SDK его не читает (это была моя ошибка из ADR-007, исправляю в lab journal).

**Workaround 1:** добавить network alias `slovo-datasets.slovo-minio` к MinIO в `docker-compose.infra.yml`:
```yaml
minio:
  networks:
    slovo-network:
      aliases:
        - slovo-datasets.slovo-minio
```

**Блокер 2 — undici ProxyAgent:** preload-скрипт `flowise-proxy-bootstrap.cjs` ставит ProxyAgent **глобально** без NO_PROXY-фильтрации. Запросы на новый alias шли через прокси `host.docker.internal:10810` → `UnknownError`.

**Workaround 2:** добавить `slovo-datasets.slovo-minio` и wildcard `.slovo-minio` в `NO_PROXY`. Но AWS SDK v3 на самом деле использует `node:https` (не undici), так что это lossless fix.

**Блокер 3 — MinIO virtual-hosted off:** SDK теперь добрался до MinIO, но MinIO ответил `NoSuchBucket`. По умолчанию MinIO работает в path-style и не извлекает bucket из subdomain — нужен `MINIO_DOMAIN=slovo-minio` чтобы он распознавал `<bucket>.slovo-minio` host header.

**Workaround 3:** добавить `MINIO_DOMAIN: slovo-minio` в env MinIO-контейнера + перезапустить.

После трёх workaround'ов ручной S3 GET через `node -e` из Flowise-контейнера вернул `OK len=917553`. MinIO связь работает.

### 12:15 — `Unsupported file type application/json; charset=utf-8`

processLoader вернул HTTP 200, но `chunks: 0`. В `docker logs slovo-flowise`:
```
Unsupported file type application/json; charset=utf-8 for file latest.json
```

Лезу в `S3File.ts:889`:

```typescript
private isTextBasedFile(mimeType: string): boolean {
  const textBasedMimeTypes = [..., 'application/json', ...]
  return textBasedMimeTypes.includes(mimeType)  // ← exact match!
}
```

`includes()` точно сравнивает строки, а MinIO возвращает `application/json; charset=utf-8` (с charset). Mismatch → файл считается unsupported → 0 чанков. **Баг Flowise S3File** — не учитывает RFC 7231 параметры в Content-Type.

**Workaround:** переписать `latest.json` в MinIO с явным content-type:
```bash
docker exec slovo-minio sh -c 'mc cp --attr "content-type=application/json" \
  local/slovo-datasets/catalogs/aquaphor/latest.json \
  local/slovo-datasets/catalogs/aquaphor/latest.json'
```

После этого Process зашёл в `isTextBased = true` ветку и обработал файл.

**Что важно для CRM-feeder (long-term):** при каждом `exportSnapshotToS3()` нужно явно ставить `ContentType: 'application/json'` в `PutObjectCommand` (без charset), иначе MinIO добавит `; charset=utf-8` сам. Это правка в `crm-aqua-kinetics-back/src/modules/moy-sklad/modules/catalog-sync/catalog-sync.service.ts`.

### 12:30 — processLoader → 912 chunks

После content-type fix:
```
elapsed_ms=931
totalChunks: 912
totalChars: 772232
status: SYNC
```

155 items × ~6 чанков/item (rich content на каждый: contentForEmbedding + categoryPath + characteristics + relatedServices + relatedComponents). 912 — много, но в пределах нормы.

### 12:35 — vectorstore/save + vectorstore/insert → 912 в catalog_chunks

POST `/api/v1/document-store/vectorstore/save` (`vectorstore-save.json`):

```json
{
  "storeId": "aec6b741-...",
  "embeddingName": "openAIEmbeddings",
  "embeddingConfig": {
    "credential": "50796497-...",
    "modelName": "text-embedding-3-small",
    "dimensions": 1536
  },
  "vectorStoreName": "postgres",
  "vectorStoreConfig": {
    "credential": "65d7f839-...",
    "host": "slovo-postgres",
    "database": "slovo",
    "port": 5432,
    "tableName": "catalog_chunks"
  }
}
```

→ HTTP 200, configs персистированы в DocumentStore entity.

POST `/api/v1/document-store/vectorstore/insert` тем же payload — **embedding (912 OpenAI calls) + INSERT в Postgres**:
```
elapsed_ms=4713
HTTP 200
```

Verify:
```bash
docker exec slovo-postgres psql -U slovo -d slovo -c "SELECT count(*) FROM catalog_chunks;"
# count = 912
```

### 12:40 — Критическое открытие: S3 File Loader игнорирует JSONLoader для application/json

При проверке metadata из БД:

```sql
SELECT "pageContent", metadata->'externalId', metadata->'name', metadata->'fileName'
FROM catalog_chunks LIMIT 1;
```

Результат:
- `pageContent` — **сырой JSON-текст** (фрагмент массива, разрезанный по 1000 chars)
- `metadata.externalId` = `"/externalId"` (литерально pointer как строка)
- `metadata.name` = `"/name"` (литерально)
- `metadata.fileName` = `"latest.json"`

То есть Flowise S3 File Loader для `application/json` идёт в **`isTextBasedFile`** ветку, обрабатывает как **plain text**, и **не запускает JSONLoader**. Additional Metadata jsonpointer'ы не применяются — они сохраняются как metadata-значения буквально.

**Это design limitation Flowise S3 File**, не баг. JSONLoader используется только в Json File Loader (Plain Text loader через UI upload), который не пуллит из S3.

### 12:45 — query API smoke → 525ms, retrieval работает

POST `/api/v1/document-store/vectorstore/query`:

```json
{ "storeId": "aec6b741-...", "query": "какой смеситель есть для кухни" }
```

```
elapsed_ms=665
timeTaken=525  ← Flowise-side, без сетевых накладных
HTTP 200
```

**Top-1 doc:**
```json
{
  "pageContent": "...contentForEmbedding: \"Название: Смеситель кухонный модель 82320-1С\\nОписание: Кухонный смеситель для водопроводной и очищенной питьевой воды\\nКатегория: Очистка воды/Аквафор/...\"",
  "metadata": {
    "fileId": "catalogs/aquaphor/latest.json",
    "fileName": "latest.json",
    "externalId": "/externalId",   ← broken (литерал)
    "name": "/name",                ← broken (литерал)
    "salePriceKopecks": "/salePriceKopecks",
    ...
  },
  "id": "f00e92b9-874e-4faf-8b34-47f006d41139",
  "chunkNo": 11
}
```

Retrieval работает: смеситель «82320-1С» — релевантный для запроса «какой смеситель для кухни». pgvector cosine similarity по сырому JSON-тексту в pageContent даёт правильный top-K несмотря на сломанную metadata.

### Сравнение Chatflow vs Document Store query API

| Метрика | Chatflow + Haiku | Document Store query | Δ |
|---|---|---|---|
| timeTaken | 4865 ms | 525 ms | **9× быстрее** |
| LLM calls | 1 (Haiku completion) | 0 | $0 на инференс |
| Embedding calls | 1 | 1 | равно |
| Hallucination risk | да (refused valid match) | нет | structured docs[] |
| UI rendering data | через `sourceDocuments[]` (так же) | прямой `docs[]` | равно |

**Document Store query API однозначно подходящий target для slovo `apps/api/catalog/search`** — быстрее, дешевле, без hallucination, и retrieval-quality не отличается от Chatflow.

---

## Phase 0 — итог

✅ **Image-search smoke (Шаг 1)** — vision-describer + Chatflow retrieval работают end-to-end. Top-1 result — точное попадание (C125).

✅ **Document Store smoke (Шаг 2)** — 912 chunks загружены через REST API без UI. Query API возвращает релевантные docs за 525 ms.

⚠️ **Архитектурное открытие:** Flowise S3 File Loader для JSON работает только как plain text — Additional Metadata jsonpointer'ы не извлекаются. Для Phase 0 smoke это **не блокер** (search работает), но для production UI rendering metadata нужна нормализованная.

### Решение по Phase 1 (PR6)

Для production UI rendering без нормализованной metadata — два пути:

1. **Slovo orchestrate** (вариант C из секции «Развилка по ingest» выше): `apps/worker` читает `latest.json` из MinIO, парсит, для каждого item POST'ит в `/api/v1/document-store/upsert/<storeId>` с inline `documents` payload, в котором pageContent = `contentForEmbedding`, metadata = весь item целиком. Это полный контроль, чёткая schema, легко dedup'ить.

2. **Patch Flowise S3 File** (форк или monkey-patch): добавить ветку для `application/json` → запуск JSONLoader с jsonpointer'ами. Сохраняет «UI-only» подход, но требует поддержки форка.

**Рекомендация:** **C — slovo orchestrate**. Reasoning:
- 152-ФЗ split, slovo всё равно должен быть active в ingest pipeline
- Контроль schema + версионирование payload между slovo и Flowise через `t-bulk-ingest-payload.ts`
- Vision_cache lookup на стороне slovo (Phase 2.5 backlog) проще когда slovo уже orchestrate ingest
- Patch Flowise — добавляет maintenance load, форк рискует разойтись с upstream

Это нужно зафиксировать обновлением **ADR-007** (вариант A с UI-only Flowise S3 — отвергнут в пользу C по итогам эксперимента).

### Архитектурный инсайт — Flowise полностью управляется через REST API

В ходе эксперимента вылезла важная находка, изменяющая модель работы со slovo:

**Всё что делается через UI Flowise — делается и через REST API.** Каждый UI-action в Document Store / Chatflow / Credentials / API Keys отображается на endpoint в `routes/`:

| UI-действие | REST endpoint |
|---|---|
| Create Document Store | `POST /document-store/store` |
| Add Document Loader | `POST /document-store/loader/save` |
| Process (chunking) | `POST /document-store/loader/process/:loaderId` |
| Configure Embedding+VectorStore | `POST /document-store/vectorstore/save` |
| Upsert All Chunks | `POST /document-store/vectorstore/insert` |
| Retrieval Query (без LLM) | `POST /document-store/vectorstore/query` |
| Refresh from source | `POST /document-store/refresh/:id` |
| Create Credential | `POST /credentials` |
| Create API key | `POST /apikey` (через UI) |

Auth: `Authorization: Bearer <flowise-apikey>`. Все enterprise-only endpoint'ы под `checkPermission()` принимают bearer token, если у key есть permissions.

**Что это значит для slovo:**

1. **`apps/worker/catalog-refresh`** не зависит от UI. По cron / RMQ message:
   ```ts
   await axios.post(`${flowiseUrl}/api/v1/document-store/refresh/${storeId}`, {}, { headers: { Authorization: `Bearer ${apiKey}` } });
   ```
   Re-embed всего каталога — один POST. Ровно то что описано в `vision-catalog-search.md` Phase 1 PR6.

2. **`apps/api/catalog/search/text`** и **`apps/api/catalog/search/image`** — тонкие proxy endpoint'ы:
   ```ts
   // text search
   const docs = await flowise.post(`/document-store/vectorstore/query`, { storeId, query });
   // image search
   const desc = await flowise.post(`/prediction/${visionDescriberId}`, { question, uploads });
   const docs = await flowise.post(`/document-store/vectorstore/query`, { storeId, query: desc.description_ru });
   ```
   ~30 LOC на endpoint, без бизнес-логики LLM/embed/vector — всё в Flowise.

3. **CI / провижининг:** Document Store + Chatflow конфиги можно держать в git как JSON (`/docs/flowise-configs/`) и применять на чистый Flowise командой:
   ```bash
   curl -X POST .../document-store/store    -d @configs/catalog-aquaphor.json
   curl -X POST .../document-store/loader/save -d @configs/loader-s3-aquaphor.json
   ```
   Воспроизводимость setup'а из коробки. Закрывает «manual UI clicks» как antipattern.

4. **Документация Flowise REST API:**
   - **Source-of-truth**: `/usr/local/lib/node_modules/flowise/dist/routes/` (все routes), `dist/services/<feature>/` (схемы payload), `dist/controllers/<feature>/` (валидация и обработка)
   - **Cloud Swagger**: `https://docs.flowiseai.com/api-reference/swagger.yml` (purport coverage частичный, не все endpoint'ы документированы)
   - **OpenAPI**: Flowise сам не отдаёт `/api/v1/openapi.json`, есть открытое issue (не пинаем)

### Возможный MCP-сервер для Flowise

Если Flowise полностью покрыт REST API — логично иметь **MCP-сервер**, превращающий эти endpoint'ы в tools для Claude. То есть мы (или другие агенты) могли бы вместо ручных curl'ов / docs-only flow:

```
User: «обнови каталог в Document Store catalog-aquaphor»
Claude → MCP tool `flowise.refresh_document_store(storeId)` → POST /document-store/refresh/<id>
```

**Поиск готового решения** — пока не сделан. Вероятные варианты на 2026-04-30:
1. Готовый `flowise-mcp` от сообщества — нужно проверить https://github.com/modelcontextprotocol/servers и hub.docker.com
2. Свой MCP-сервер на основе Anthropic MCP TypeScript SDK — обёртка вокруг Flowise REST API. Маленький проект, ~200 LOC.

Это ложится в общую тему slovo «AI-платформа для прототипирования LLM-фичей» — MCP-серверы поверх внутренних API (Flowise, Prisma, MinIO) — естественное расширение.

**Backlog (не для текущего PR):**
- ADR на тему Flowise-MCP — нужен ли свой или использовать готовый
- Если готового нет — `apps/mcp-flowise` в monorepo как сервер
- Документировать REST API в slovo-side (`docs/integrations/flowise-api.md`) до тех пор, пока MCP не готов

### Reproducible recipe

Все артефакты для повтора в slovo `apps/worker` (Phase 1):
- `loader-save.json` — payload для loader/save
- `vectorstore-save.json` — payload для vectorstore/save
- env `UNSTRUCTURED_API_URL`, `MINIO_DOMAIN`, network alias, `NO_PROXY` — в `docker-compose.infra.yml`
- API key bearer auth — на Flowise UI Credentials → API Keys

### Сохранённые артефакты (день 2)

- `loader-save.json` — Document Store loader payload
- `vectorstore-save.json` — embedding + vectorstore config payload
- `query-c125.json` — search query payload
