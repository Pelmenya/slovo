# ADR-006: Knowledge Base как первая фича и core capability

## Статус
✅ Принято — 2026-04-23 (финализировано после экспериментов A, B, C в Flowise 3.1.2 + чтения исходника)
🟡 **Амендмент 2026-05-02 — приоритет пересмотрен:** knowledge-base отложена. См. секцию «Амендмент 2026-05-02 — vision-catalog как фактическая первая фича» внизу ADR.

## Контекст

У slovo в roadmap три кандидата на первую фичу (см. `CLAUDE.md`): `water-analysis`, `notes-rag`, `multi-tenant`. Разработчик дополнительно хочет реализовать **транскрибацию видео** (портировать логику из `C:\Users\Diamond\Desktop\video-transcriber\transcribe.js`) — как инструмент, чтобы **скармливать вебинары экспертов в контекст моделей**.

Анализ паттерна использования (см. `docs/features/knowledge-base.md`):

- Транскрибация сама по себе — CLI-скрипт без самостоятельной ценности в рамках AI-платформы.
- **Настоящая цель** — превращать экспертные материалы (вебинары, заметки, методички) в контекст для LLM. Это паттерн **SME cloning**.
- У разработчика есть прецедент из `backend/docs/features/seo-generator.md`: там транскрипт интервью с экспертом используется как источник для структурированной методологии, потом подмешивается в промпт.
- Этот же паттерн нужен для всех будущих domain-фич slovo (water-analysis, seo-clone, etc.) — все они хотят "иметь методологию эксперта в retrieval".

## Решение

**Knowledge Base — первая фича slovo и одновременно core capability платформы.**

Двойная роль:

1. **Фича для конечного пользователя** — API для загрузки источников (видео/текст/PDF/...), поиска и Q&A по ним. Полностью self-contained, имеет продуктовую ценность сама по себе (аналог NotebookLM).
2. **Core capability для domain-фич** — те же самые ingestion + chunking + embeddings + retrieval используются будущими фичами (seo-generator, water-analysis). Они становятся тонкими обёртками "свой промпт + retrieval + Claude".

### Архитектурные принципы

1. **Polymorphic ingestion с первого дня.** Любой источник (текст, видео, аудио, PDF, URL) проходит через `TSourceAdapter` → унифицированный `extractedText` → одинаковый chunking/embedding pipeline.
2. **Транскрибация — один из адаптеров.** Не отдельная фича, не отдельный libs/модуль верхнего уровня. Живёт в `libs/ingest/adapters/video/`.
3. **Phases по ценности, не по технологии.** MVP — text-only (минимум работы, максимум validation). Phase 2 — video (основной use case разработчика). Phase 3 — первая domain-фича как showcase.
4. **Storage абстрагирован.** S3-compatible API (MinIO в dev, любой managed S3 в prod). Видео/аудио/PDF не попадают в Postgres.
5. **Embedder и retriever за интерфейсами.** Замена модели (OpenAI → Cohere multilingual) — прозрачная для domain-фич.

### Слои

```
libs/storage/       — S3/MinIO абстракция
libs/ingest/        — TSourceAdapter + реализации (text, video через Groq Whisper, ...)
libs/llm/           — тонкий HTTP-клиент к Flowise Prediction API (ADR-004)

apps/api/src/modules/knowledge/   — REST API для ingestion + search + ask
apps/worker/src/modules/ingest/   — RMQ consumer для async адаптеров (video/audio)
apps/api/src/modules/<feature>/   — domain-фичи (обёртки над knowledge + flowise chatflow)
```

**Note:** `libs/knowledge/` (с embedder/chunker/retriever руками через `$queryRaw`) **исчез из плана** по результатам эксперимента C. Вся ingestion-в-pgvector логика + retrieval делегируется **Flowise Postgres vector store ноде** и **Flowise Vector Upsert API**. См. «Дизайн таблиц» ниже.

### Дизайн таблиц — две таблицы (2026-04-23)

По результатам эксперимента C (чтение исходника `packages/components/nodes/vectorstores/Postgres/driver/TypeORM.ts`):

**Flowise Postgres vector store** создаёт таблицу с фиксированной схемой:

```sql
CREATE TABLE IF NOT EXISTS ${tablename} (
    "id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    "pageContent" text,
    metadata jsonb,
    embedding vector
);
```

Попытка Prisma-миграцией создать таблицу `knowledge_chunks` с нашими колонками (`sourceId`, `text`, `position`, `createdAt`) привела бы к конфликту при первом upsert из Flowise (Flowise пытается INSERT в `pageContent`/`metadata`/`embedding`, которых у нас нет).

**Решение — разделить ownership:**

| Таблица | Кто владеет | Схема | Назначение |
|---|---|---|---|
| `knowledge_sources` | **Prisma** | id, userId, sourceType, status, progress, title, storageKey, metadata, createdAt, updatedAt | CRUD метаданных источников. Реестр всех загруженных материалов пользователя. |
| `knowledge_chunks` | **Flowise** | id, pageContent, metadata (jsonb), embedding (vector) | Фрагменты с эмбеддингами для retrieval. Flowise создаёт при первом upsert, сам управляет. |

**Связь между ними** — через `metadata.source_id` в chunks (app-level FK, не database constraint).

**Multi-tenant isolation** — через `metadata.user_id` в chunks + **pgMetadataFilter** в Flowise Postgres ноде:
```json
{ "user_id": "${req.user.id}" }
```
Это транслируется Flowise в `WHERE metadata @> '{"user_id":"..."}'::jsonb` — SQL-уровень, никакой утечки.

**HNSW индекс** — отдельная Prisma миграция через `--create-only` (после первого upsert Flowise таблица существует, индекс уже можно создавать):

```sql
-- prisma/migrations/YYYYMMDD_add_hnsw_index/migration.sql
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding_hnsw
ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_metadata
ON knowledge_chunks USING gin (metadata);
```

**Cleanup при удалении source** — NestJS-хук:
```typescript
async deleteSource(sourceId: string) {
    await this.prisma.knowledgeSource.delete({ where: { id: sourceId } });
    await this.flowiseClient.deleteVectorsByMetadata(chatflowId, {
        source_id: sourceId,
    });
}
```

### Почему не VIEW и не переименование колонок Prisma

- **VIEW** — Flowise `CREATE TABLE IF NOT EXISTS` не поймёт существующий VIEW как таблицу. Плюс INSERT через VIEW требует INSTEAD OF триггеров — overhead.
- **Переименовать колонки в Prisma** (`pageContent` вместо `text`) — работает, но Prisma-схема становится неестественной (camelCase в SQL, отсутствие FK на source) — больше путаницы чем выгоды.
- **Две таблицы** — чистое разделение, минимум связанности.

## Альтернативы

### A. Transcription как отдельная фича, RAG потом

**Плюсы:**
- Быстрее первый коммит фичи (только STT pipeline, без pgvector)
- Отдельный продукт, который можно продать отдельно

**Минусы:**
- Через 1-2 месяца всё равно понадобится RAG для domain-фич → рефакторинг на промежуточном этапе
- Транскрибация без контекста использования — "скрипт в обёртке", не AI-платформа

**Отклонена:** слишком узкий scope, не соответствует видению slovo как AI-платформы.

### B. Водный анализ или SEO-клон как первая фича

**Плюсы:**
- Конкретный domain, чётко измеримый impact

**Минусы:**
- Нужны **те же** ingestion + RAG + LLM — просто делаем их неявно, плохо выделенными
- Вторая domain-фича переизобретёт половину

**Отклонена:** domain-фичи должны быть **потребителями** готового knowledge base, не его построителями.

### C. Сразу делать многофункциональный NotebookLM-клон (все адаптеры PDF/video/youtube/web сразу)

**Плюсы:**
- Полный продукт с первого релиза

**Минусы:**
- 4-6 недель работы до первой ценности
- Половина адаптеров могут оказаться не нужны (например, YouTube URL — если все источники уже локальные файлы)

**Отклонена:** нарушает принцип "MVP → добавляем по потребности".

## Последствия

### Положительные

- Первая фича slovo имеет самостоятельную продуктовую ценность (можно показать, можно использовать как есть).
- Все будущие domain-фичи получают готовую инфраструктуру — экономия 50-70% работы на каждой.
- Архитектура соответствует ADR-001 (modular monolith): `knowledge` — feature module в `apps/api`, общие слои в `libs/`.
- Соответствует ADR-002 (pgvector) и ADR-004 (Claude primary).

### Отрицательные

- Больший scope первой фичи (~4-6 недель вечеров на полный план vs 2 недели на "просто транскрибация").
- Необходимо выбрать embedder (OpenAI vs Cohere) и validate'ить качество на русском раньше, чем это стало бы критичным для domain-фичи.
- MinIO добавляется в docker-compose infra — ещё один сервис в стеке.

### Нейтральные

- `notes-rag` из roadmap `CLAUDE.md` **есть** knowledge base — просто под другим именем. Переименовать в roadmap-е или оставить как "Phase 3 showcase — notes-rag поверх knowledge base".
- `water-analysis` из roadmap откладывается до Phase 3+ — станет demo использования knowledge base.

## План реализации

См. `docs/features/knowledge-base.md` — детализированный план по фазам, open questions, metrics, risks.

Короткая сводка фаз:

1. **Phase 1 (~1.5 нед.):** text-only knowledge base + search API + MinIO + pgvector HNSW
2. **Phase 2 (~2 нед.):** video/audio адаптеры через Groq Whisper + RMQ worker
3. **Phase 3 (~1 нед.):** showcase domain-фича (notes-rag Q&A endpoint)
4. **Phase 4+:** PDF, DOCX, YouTube URL, web article адаптеры — по потребности

## Когда пересмотреть

- Если после Phase 1 retrieval recall на русском < 70% → пересмотреть выбор embedder.
- Если Groq Whisper не выдерживает объём на Phase 2 → переключиться на OpenAI Whisper или self-hosted.
- Если domain-фича в Phase 3 покажет что нужен hybrid search (vector + BM25) → добавить в knowledge base, обновить retriever.

---

## Амендмент 2026-05-02 — vision-catalog как фактическая первая фича

**Что произошло между 2026-04-23 и 2026-05-02:**

Knowledge-base **не стартовала**. Вместо неё за 9 дней реализована и закрыта в продакшен `vision-catalog-search` (Phase 1 + Phase 2):

- `POST /catalog/search` — universal endpoint (text / до 5 фото / комбо)
- Catalog ingest pipeline через MinIO bucket → Flowise Document Store с RecordManager skip-if-unchanged
- Vision augmentation на ingest (Phase 2): 155 товаров обогащены AI-описанием через Haiku 4.5
- Pre-launch hardening (per-IP/IPv6-/64 throttle, SHA256 image-cache, budget cap + Telegram alert)
- 591 unit-тест, фактический billing $0.49 ≈ 39 ₽ за всю разработку

**Архитектурное последствие:** vision-catalog построен **standalone**, БЕЗ слоя `libs/knowledge/` / `libs/ingest/`. Использует Flowise Document Store напрямую через `apps/mcp-flowise` + `libs/flowise-client`. Таблицы `knowledge_sources` / `knowledge_chunks` **не созданы** (Prisma модель из секции «Дизайн таблиц» этого ADR — не материализована).

**Почему так получилось:**

1. **Бизнес-приоритет.** У разработчика появился реальный заказчик (Aquaphor Pro CRM + клиентский фронт `prostor-app`) с нуждой в каталог-поиске. Knowledge-base как первая фича — продуктово оправдана как платформа, но без конкретного потребителя сначала.
2. **Vision-catalog не нуждается в polymorphic ingestion.** Источник один (MinIO bucket с CSV из CRM), формат фиксированный, обновление по cron. Полный slate `TSourceAdapter` + chunking + retrieval-абстракции — overkill.
3. **Flowise Document Store + Vision augmenter** покрывает retrieval для catalog-кейса нативно. Прямое использование `flowise_docstore_query` через MCP оказалось проще чем строить knowledge-base слой как промежуточный.

**Что это значит для ADR-006:**

- **Решение «knowledge-base = core capability»** остаётся валидным как **долгосрочное** видение. Для notes-rag, water-analysis и любой будущей domain-фичи с polymorphic ingestion (видео + PDF + текст) этот слой будет оправдан.
- **Решение «knowledge-base = первая фича»** — **устарело по факту**. Первая фича — vision-catalog (Phase 1+2 закрыты 2 мая 2026). Knowledge-base сдвигается в Phase 3+ или позже.
- **Дизайн таблиц (две таблицы, Flowise-managed `knowledge_chunks`)** — остаётся актуальным как guidance для будущей реализации. Подтверждён работающим на vision-catalog (Document Store работает по этой схеме под капотом).

**Roadmap пересмотр:**

Knowledge-base реактивируется когда появится конкретный потребитель:
- запрос на Q&A по экспертным вебинарам / методичкам,
- запрос на water-analysis с retrieval из лабораторных guidelines,
- внешний клиент slovo как платформы со своими источниками.

Пока этого нет — `docs/features/knowledge-base.md` остаётся черновиком-roadmap'ом, не задачей в работе.

**Связанные документы:**

- `docs/features/vision-catalog-search.md` — реализованная фича
- `docs/features/knowledge-base.md` — отложенный план (статус обновлён 2026-05-02)
- `docs/architecture/decisions/007-catalog-ingest-via-minio.md` — ingest contract который заменил knowledge-base ingestion для catalog-кейса
- `docs/architecture/decisions/008-flowise-mcp.md` — инфраструктура которая позволила обойтись без knowledge-base слоя
