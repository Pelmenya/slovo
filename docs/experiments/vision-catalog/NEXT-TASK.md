# Task: завершить Phase 0 catalog-search через Flowise Document Store

> **Контекст:** мы внутри slovo-проекта (`C:\Users\Diamond\Desktop\slovo`), пилим фичу catalog-search с архитектурой **Level 1 (минимум кода)** — Flowise делает auto-pull каталога из MinIO, slovo тонкий клиент.

## Что прочитать перед стартом

### Обязательно (без этого не начинать)

1. **`CLAUDE.md`** (project root) — общий контекст разработчика, стек, принципы, ADR-индекс. Загружается автоматически Claude Code.
2. **`MEMORY.md`** (auto-loaded) — рефлексы и feedback'и. Особенно эти entries напрямую релевантны задаче:
   - `project_flowise_two_subsystems` — Chatflow vs Document Store, разные API
   - `feedback_read_flowise_source` — лезть в `/usr/local/lib/node_modules/flowise/dist/` при сомнениях
   - `project_flowise_minio_s3_endpoint` — AWS env-fallback для MinIO
   - `project_flowise_runtime_decision` — Flowise = LLM runtime, slovo = thin client
   - `project_flowise_proxy_bootstrap` — undici ProxyAgent для outbound к OpenAI/Anthropic
   - `feedback_check_memory_before_architecture` — grep memory перед решениями
   - `feedback_curl_noproxy` — `--noproxy '*'` на Windows curl
   - `feedback_mermaid_over_ascii` — Mermaid в `.md`, текст в чате
   - `feedback_review_after_push` — после `git push` спавнить ревью-агентов

### Доки фичи catalog-search (по порядку)

3. **`docs/features/vision-catalog-search.md`** — главный план фичи. Что строим, зачем, UX-сценарии (text/image/agentic), Prisma-schema (исходный план до пивота на Level 1), bulk ingest contract, Phases по PR'ам, Open questions (#1 и #2 закрыты после Phase 0), стоимость (ingest vs query), 3 стратегии оптимизации.
4. **`docs/architecture/decisions/007-catalog-ingest-via-minio.md`** — ADR file-based pull через shared MinIO (а не HTTP push). Контекст почему отказались от push, альтернативы (RMQ, db-mediated), последствия, open questions.
5. **`docs/experiments/vision-catalog/2026-04-29-document-store-vector-pipeline.md`** — lab journal текущего эксперимента. Здесь хронологический лог всех находок 2026-04-29: Json File loader caveats, S3 File Loader gotcha, пивот на Level 1, vision-describer test на C125 image.
6. **`docs/guides/flowise-vs-nestjs.md`** — главный operational guide по Flowise. Особенно секции **A** (cache_control), **B** (overrideConfig.promptValues), **C** (Postgres vector store), **D** (Phase 0 catalog-search end-to-end), **E** (open question #2 — retriever-only через Document Store), **F** (open question #1 — table name).

### Связанные ADR (для понимания общей картины)

7. **`docs/architecture/decisions/006-knowledge-base-as-first-feature.md`** — knowledge-base первая фича slovo, паттерн ownership-split (Prisma metadata + Flowise embeddings), который мы переиспользуем для catalog (но в Level 1 без metadata-таблицы).
8. **`docs/architecture/decisions/004-claude-as-primary-llm.md`** — выбор Claude + Flowise abstraction для multi-provider switching.
9. **`docs/architecture/decisions/005-prisma-with-pgvector.md`** — Prisma + raw queries для pgvector (если когда-то понадобится прямой SQL в slovo помимо Flowise).
10. **`docs/architecture/decisions/001-modular-monolith.md`**, **`002-postgres-pgvector.md`**, **`003-rabbitmq-vs-bullmq.md`** — фундамент стека.

### Связанные feature-планы

11. **`docs/features/knowledge-base.md`** — параллельная фича, тот же подход (Flowise + pgvector). Полезно для понимания паттерна Polymorphic ingestion.
12. **`docs/architecture/tech-debt.md`** — список отложенных hardening-задач (валидация env, JWT replace `DevOnlyHeaderAuthGuard`, throttle, pool tuning). Важно для production-readiness.

### CRM-side (отдельный репо, контекст контракта)

13. **CRM**: `crm-aqua-kinetics-back/src/modules/moy-sklad/modules/catalog-sync/` — feeder, который кладёт `latest.json` в MinIO. Главные файлы:
    - `types/t-bulk-ingest-payload.ts` — schema контракта (что Slovo получит из bucket'а)
    - `helpers/compute-item-content-hash.ts` — детерминированный hash (не используется в Level 1, но поле есть в payload)
    - `catalog-sync.service.ts` — основной service с `exportSnapshotToS3()`
    - Commits в CRM: `148194f` (initial export), `da99f92` (image download + groupImageKeys + contentHash), `66cec69` (hardening — PII filter, OOM cap, типизация, тесты)

---

## Цель

Закрыть Phase 0 двумя smoke-тестами:

1. **Image search end-to-end** через существующий Chatflow (быстрый sanity check)
2. **Production setup** — Document Store `catalog-aquaphor` с S3 File Loader → MinIO → 155 items, query API без LLM

---

## Текущее состояние (на момент начала задачи)

### Что РАБОТАЕТ
- ✅ CRM (`crm-aqua-kinetics-back`, отдельный репо) выгружает `latest.json` + binary картинок в MinIO bucket `slovo-datasets/catalogs/aquaphor/...` (commits 148194f, da99f92, 66cec69 в CRM-репо)
- ✅ Chatflow **`catalog-embed-search`** в Flowise (id `2e016504-1e83-498f-b3b5-4baba11db5dd`) — Json File Loader → Recursive Splitter (chunk 1000, overlap 200) → OpenAI Embeddings (text-embedding-3-small, 1536-dim) → Postgres → Conversational Retrieval QA Chain + Claude Haiku 4.5 + Buffer Memory
- ✅ Chatflow **`vision-catalog-describer-v1`** (id `991f9b70-fdae-47cf-bc20-4f3261034216`) — image → JSON description, протестирован на C125 (см. lab journal 13:00)
- ✅ Postgres таблица `catalog_chunks` создана при первом upsert (Flowise managed, schema `id/pageContent/metadata/embedding`)
- ✅ AWS env переменные в Flowise-контейнере для MinIO compatibility (commit `b694468`):
  - `AWS_ENDPOINT_URL_S3=http://slovo-minio:9000`
  - `AWS_S3_FORCE_PATH_STYLE=true`
  - `AWS_DEFAULT_REGION=us-east-1`

### Что НЕ ДОДЕЛАНО
- ❌ `catalog_chunks` сейчас **пустой** (TRUNCATEd сегодня в начале сессии при экспериментах)
- ❌ Document Store **`catalog-aquaphor`** в Flowise UI создан, но **EMPTY** — без Document Loader, без embedding/vectorstore конфига
- ❌ AWS Credential для MinIO в Flowise UI **НЕ создан** (нужен `minioadmin` / `slovo_dev_minio_password_change_me` из `.env`)
- ❌ Image search end-to-end НЕ прогнан (vision-describer один работает, но search через Chatflow с описанием от vision'а не тестировали)

### Артефакты на диске (для повтора тестов)
- `C:\Users\Diamond\Desktop\slovo\sample-3items.json` — 3 sample товара для UI smoke (untracked)
- `C:\Users\Diamond\Desktop\slovo\c125-b64.txt` — base64 картинки C125 (185 KB)
- `C:\Users\Diamond\Desktop\slovo\vision-req.json` — готовый payload prediction API
- `C:\Users\Diamond\Downloads\latest (1).json` — полный snapshot 155 items (вчерашний)

---

## Шаги задачи

### Шаг 1 — Image search smoke (Путь A, 5 мин)

**Цель:** убедиться что vision → text → search end-to-end работает на существующей инфре.

**Подшаги:**

1. Попросить пользователя в Flowise UI открыть Chatflow `catalog-embed-search` и нажать **Upsert Vector Database** (иконка БД с стрелкой вверх). Файл `sample-3items.json` уже залит в Json File ноду. Ожидать `Added: 4`.

2. Подтвердить через SQL: `SELECT count(*) FROM catalog_chunks;` → должно быть 4.

3. Дёрнуть vision-describer на готовом payload:
   ```bash
   curl -s --noproxy '*' -X POST http://127.0.0.1:3130/api/v1/prediction/991f9b70-fdae-47cf-bc20-4f3261034216 \
     -H "Content-Type: application/json" \
     --data-binary @"C:/Users/Diamond/Desktop/slovo/vision-req.json"
   ```
   В прошлом запуске вернул JSON с `description_ru: "Кран смеситель для питьевой воды..."`.

4. Извлечь `description_ru` из ответа, сформировать payload для Conversational Retrieval QA Chain:
   ```json
   { "question": "<description_ru>" }
   ```

5. Дёрнуть search:
   ```bash
   curl -s --noproxy '*' -X POST http://127.0.0.1:3130/api/v1/prediction/2e016504-1e83-498f-b3b5-4baba11db5dd \
     -H "Content-Type: application/json" \
     --data-binary @<query.json>
   ```
   Проверить что `sourceDocuments[]` содержит C125 (externalId `7194736b-19d6-11e7-7a31-d0fd00056ba7`) или хотя бы какой-то смеситель из 3-х.

6. Записать результат в lab journal (`docs/experiments/vision-catalog/2026-04-29-document-store-vector-pipeline.md` секция «Лог итераций» новой записью с timestamp).

### Шаг 2 — Document Store setup (Путь B, 15 мин)

**Цель:** настроить production-target — Flowise сам пуллит `latest.json` из MinIO без участия Plain Text/Json File loader, тестируем `/document-store/vectorstore/query` без LLM.

**Подшаги:**

1. **Flowise UI → Credentials → + Add Credential → AWS API:**
   - Credential Name: `minio-slovo-datasets`
   - AWS Access Key: `minioadmin` (из `.env` `MINIO_ROOT_USER`)
   - AWS Secret Access Key: `slovo_dev_minio_password_change_me` (из `MINIO_ROOT_PASSWORD`)

2. **Document Stores → catalog-aquaphor → + Add Document Loader → S3 File:**
   - AWS Credential: `minio-slovo-datasets`
   - Bucket: `slovo-datasets`
   - Object Key: `catalogs/aquaphor/latest.json`
   - Region: `us-east-1` (env переопределит endpoint)
   - File Processing Method: `Built In Loaders`

3. **Внутри S3 File loader конфига:**
   - Text Splitter: Recursive Character (chunk 1000, overlap 200)
   - **Additional Metadata** (JSON-редактор, через `+ Add` поштучно):
     ```
     externalId        →  /externalId
     externalType      →  /externalType
     name              →  /name
     description       →  /description
     salePriceKopecks  →  /salePriceKopecks
     categoryPath      →  /categoryPath
     imageUrls         →  /imageUrls
     rangForApp        →  /rangForApp
     relatedServices   →  /relatedServices
     relatedComponents →  /relatedComponents
     ```
   - Все значения — со слэшем впереди (jsonpointer RFC 6901). Без скобок, без кавычек.

4. **Embedding Configuration → OpenAI Embeddings:**
   - Connect Credential: `openai-dev`
   - Model Name: `text-embedding-3-small`
   - Dimensions: `1536`

5. **Vector Store Configuration → Postgres:**
   - Connect Credential: `postgres-slovo-dev`
   - Host: `slovo-postgres`
   - Database: `slovo`
   - Port: `5432` (внутренний docker-сетевой)
   - Table Name: `catalog_chunks` (тот же, переиспользуем)

6. **TRUNCATE catalog_chunks** перед Process чтобы не накопить дубли:
   ```bash
   docker exec slovo-postgres psql -U slovo -d slovo -c "TRUNCATE catalog_chunks;"
   ```

7. **Process & Upsert** — Flowise сам прочитает `latest.json` из MinIO, разберёт JSON, чанкует, embed'ит, запишет в Postgres. Ожидать ~155 items × 1-3 chunks = ~200-400 чанков.

8. **Получить storeId**:
   ```bash
   docker exec slovo-flowise sh -c "sqlite3 /root/.flowise/database.sqlite \"SELECT id FROM document_store WHERE name='catalog-aquaphor';\""
   ```

9. **Smoke-test query API** (БЕЗ LLM):
   ```bash
   echo '{"storeId":"<storeId>","query":"какой смеситель есть для кухни"}' > /tmp/q.json
   curl -s --noproxy '*' -X POST http://127.0.0.1:3130/api/v1/document-store/vectorstore/query \
     -H "Content-Type: application/json" \
     --data-binary @/tmp/q.json
   ```
   Ожидать: `{ timeTaken, docs: [{pageContent, metadata: {externalId, name, salePriceKopecks, imageUrls, ...}, id}] }`. Должны вернуться смесители C125/C126/82138C.

10. **Сравнение Chatflow + Haiku vs Document Store query** в таблице — занести в lab journal:
    - timeTaken (~150ms vs ~1500ms ожидаемо)
    - LLM calls (0 vs 1)
    - cost / query

### Шаг 3 — финал

1. **Закоммитить** lab journal с результатами обоих шагов:
   ```
   docs(experiments): Phase 0 закрыта — image-search и Document Store query
   ```

2. **Запушить** в slovo (`git push origin HEAD`).

3. **Спавнить ревью-агентов** (по правилу из CLAUDE.md, в фоне) — но это docs-only коммит, достаточно `architect-reviewer` чтобы убедиться что описание соответствует реальности.

4. **Предложить пользователю** идти в PR6 (apps/worker `catalog-refresh` + apps/api `catalog/search/text` + `catalog/search/image`) — теперь у нас полный понятный контракт между slovo и Flowise.

---

## Важные принципы при выполнении

- **Не дёргайся менять архитектуру.** Level 1 (минимум кода) уже зафиксирован после долгого обсуждения. Если возникнет соблазн добавить vision_cache / contentHash dedup — НЕ добавляй, отдельная история на потом.
- **Mermaid в `.md` файлах, текст в чате.** GitHub рендерит mermaid, чат — нет. Стрелки/таблицы для чата.
- **Секреты не в чате**, не светить ключи. MinIO dev-ключи в `.env` (memory `feedback_secrets_in_chat.md`).
- **Тесты обязательны** для slovo TS-кода (memory `feedback_test_coverage.md`). Lab journal без тестов — это документация, не код.
- **Всё что Flowise делает — в Flowise.** Slovo только тонкие endpoints. Не предлагай OpenAI/Anthropic SDK напрямую (memory `project_flowise_runtime_decision`).

---

## Ожидаемый результат сессии

- Phase 0 закрыта обоими smoke-тестами в lab journal
- Document Store `catalog-aquaphor` наполнен 155 items с rich metadata (для UI rendering без Prisma)
- Подтверждено: query API без LLM работает на ~150ms
- Готовы переходить к slovo `apps/api` коду (PR6)
- Один docs-only commit + push в slovo
