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

### Шаг 1 — создать Document Store (Vector)

**Цель:** настроить Document Store с тем же embedding и vector store что использует Chatflow.

**Действия:**

1. _ToDo: открыть Flowise UI → левое меню → Document Stores_
2. _ToDo: + Add New → выбрать `Document Store (Vector)`_
3. _ToDo: Name: `catalog-aquaphor`, Description: `Каталог Аквафор для semantic search через slovo`_
4. _ToDo: Embedding Configuration → OpenAI Embeddings:_
   - Connect Credential: `openai-dev`
   - Model Name: `text-embedding-3-small`
   - Dimensions: `1536`
5. _ToDo: Vector Store Configuration → Postgres:_
   - Connect Credential: `postgres-slovo-dev`
   - Host: `slovo-postgres`
   - Database: `slovo`
   - Port: `5432`
   - **Table Name: `catalog_chunks`** (тот же что у Chatflow)

**Результат:**
- _ToDo: storeId = ?_
- _ToDo: URL store'а = ?_

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

### _ToDo:_ запись по мере прогресса
