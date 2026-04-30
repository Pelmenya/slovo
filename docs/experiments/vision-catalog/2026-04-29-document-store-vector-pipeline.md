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

### _ToDo:_ запись по мере прогресса
