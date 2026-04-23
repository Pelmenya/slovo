# ADR-006: Knowledge Base как первая фича и core capability

## Статус
🟡 В обсуждении — 2026-04-22

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

1. **Polymorphic ingestion с первого дня.** Любой источник (текст, видео, аудио, PDF, URL) проходит через `ISourceAdapter` → унифицированный `extractedText` → одинаковый chunking/embedding pipeline.
2. **Транскрибация — один из адаптеров.** Не отдельная фича, не отдельный libs/модуль верхнего уровня. Живёт в `libs/ingest/adapters/video/`.
3. **Phases по ценности, не по технологии.** MVP — text-only (минимум работы, максимум validation). Phase 2 — video (основной use case разработчика). Phase 3 — первая domain-фича как showcase.
4. **Storage абстрагирован.** S3-compatible API (MinIO в dev, любой managed S3 в prod). Видео/аудио/PDF не попадают в Postgres.
5. **Embedder и retriever за интерфейсами.** Замена модели (OpenAI → Cohere multilingual) — прозрачная для domain-фич.

### Слои

```
libs/storage/       — S3/MinIO абстракция
libs/ingest/        — ISourceAdapter + реализации (text, video через Groq Whisper, ...)
libs/knowledge/     — IEmbedder, IChunker, IRetriever (pgvector через $queryRaw)
libs/llm/           — абстракция LLM (ADR-004, Claude primary)

apps/api/src/modules/knowledge/   — REST API для ingestion + search + ask
apps/worker/src/modules/ingest/   — RMQ consumer для async адаптеров (video/audio)
apps/api/src/modules/<feature>/   — domain-фичи (обёртки над knowledge + llm)
```

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
