# Архитектура slovo

> Цель: универсальная платформа для построения LLM-приложений, от экспериментов до SaaS.

## Принципы

### 1. Modular monolith

Один деплой, но чёткие границы между модулями. Каждая фича — изолированная библиотека (`libs/`). Когда одна фича упирается в масштаб — выносится в отдельный сервис без переписывания.

Детали: [ADR-001](decisions/001-modular-monolith.md).

### 2. Workspace-монорепо на npm

Две команды (`npm install`, `npm run ...`) — и весь стек под рукой. Никаких Nx/Turborepo — нативный npm workspaces.

### 3. Shared libraries через path aliases

```typescript
import { PrismaService } from '@slovo/database';
import { LLMProvider } from '@slovo/llm';
```

Пути настроены в `tsconfig.json`. Код `libs/` используется в `apps/api/` и `apps/worker/` без дублирования.

### 4. Prisma как единый источник правды для типов

Схема БД определяется в `prisma/schema.prisma`. На её основе генерируется:

- Prisma Client (типизированный доступ к БД)
- NestJS DTO с `@ApiProperty` (Swagger) + `@IsString` (class-validator)
- Entity-классы для API-ответов

Изменил схему → `npm run prisma:generate` → всё синхронизировано.

Детали: [ADR-005](decisions/005-prisma-with-pgvector.md).

### 5. Observability с первого дня

Три источника телеметрии:

- **Pino logs** (structured JSON) — всё что происходит в приложении
- **Langfuse** — LLM-специфичные трейсы (промпты, токены, стоимость)
- **(future)** Prometheus + Grafana — системные метрики

### 6. Асинхронность через RabbitMQ

LLM-запросы долгие (3-30 секунд), vision-анализ ещё дольше. HTTP-запрос не ждёт выполнения — кладёт в очередь, клиент получает `jobId` и подписывается на статус.

Детали: [ADR-003](decisions/003-rabbitmq-vs-bullmq.md).

---

## Приложения

### `apps/api` — HTTP API

NestJS HTTP-сервер. Принимает запросы, валидирует, кладёт в очередь RabbitMQ, отдаёт клиенту либо результат (быстрые операции), либо jobId (долгие).

- Swagger на `/api/docs`
- Rate limiting через `@nestjs/throttler`
- CORS через env-переменную
- Validation + serialization глобально

### `apps/worker` — RabbitMQ consumer + cron

NestJS микросервис-воркер. Слушает очереди, выполняет долгие задачи (генерация, анализ фото, индексация документов), запускает периодические cron-джобы (catalog-refresh каждые 4 часа). Результаты пишет в БД, клиенту сообщает через webhooks/WebSocket/polling.

Параллельность через `prefetchCount` и несколько инстансов.

### `apps/mcp-flowise` — MCP-сервер для Flowise

Standalone-executable (не Nest-app). 66 typed tools-зеркал Flowise REST API: Document Stores / Chatflows / Predictions / Credentials / Variables / Custom Tools / Assistants / discovery / composite helpers. Используется Claude Code и slovo runtime для управления Flowise без curl-ритуалов. План extract в `Pelmenya/mcp-flowise` + npm/Smithery — см. [ADR-008](decisions/008-flowise-mcp.md).

---

## Библиотеки

### `libs/common`

- DTO-базы
- Errors (`LLMError`, `ValidationError`, и т.д.) с HTTP-маппингом
- Interceptors (request ID, logging, serialization)
- Pipes (кастомная валидация)

### `libs/database`

- `PrismaService` — инжектируемый клиент
- Сгенерированные DTO из Prisma-схемы
- Миграции через `npm run prisma:migrate:dev`

### `libs/llm`

Абстракция над LLM-провайдерами:

```typescript
type TLLMProvider = {
    generate(params: TLLMRequest): Promise<TLLMResponse>;
    stream(params: TLLMRequest): AsyncIterable<TLLMChunk>;
    embed(text: string): Promise<number[]>;
};
```

Реализации: `ClaudeProvider`, `OpenAIProvider`, `OllamaProvider`, `FlowiseProvider` (через Prediction API).

Выбор провайдера по env или per-feature конфигу.

Детали: [ADR-004](decisions/004-claude-as-primary-llm.md).

---

## Хранилище

### PostgreSQL 18 + pgvector 0.8.2

Одна БД для всего:

- Реляционные данные (пользователи, фичи, задачи)
- Векторные индексы (embeddings для RAG)

Вместо Pinecone/Qdrant/Chroma — `pgvector` с HNSW-индексом. Минимум инфры, достаточно для 99% задач.

Детали: [ADR-002](decisions/002-postgres-pgvector.md).

### Valkey 9

- Кэш LLM-ответов (одинаковые запросы = одинаковые ответы)
- SHA256 image-cache для Vision dedup (catalog-search image-mode)
- Rate limiting (токены по user_id / IP / IPv6-/64 prefix)
- Session storage (для conversational фич)

BSD-3 лицензия, API-совместим с Redis.

### RabbitMQ 4

Очереди для асинхронных задач. Management UI из коробки.

### MinIO (S3-совместимое хранилище)

- Catalog ingest contract — CRM кладёт CSV + фото товаров в shared bucket, slovo тянет по cron (см. [ADR-007](decisions/007-catalog-ingest-via-minio.md))
- Будущие video/PDF blob'ы (когда knowledge-base реактивируется)

---

## LLM-слой

### Flowise 3.1.2

LLM runtime + RAG-orchestration слой:

- Document Stores с native vector store + RecordManager (skip-if-unchanged)
- Chatflow с ChatAnthropic / OpenAI Embeddings / Vision
- MCP-интеграций (управление через `apps/mcp-flowise`)

Вызывается из NestJS через `libs/flowise-client` (REST). Управление инстансом — программно через `apps/mcp-flowise` (66 tools), не через UI.

### Claude (основная LLM)

- `claude-sonnet-4-6` — основная генерация
- `claude-haiku-4-5` — быстрые/дешёвые операции
- Vision для анализа изображений

### Langfuse (observability)

- Трейсы LLM-вызовов
- Сессии (многошаговые диалоги)
- Стоимость per-user / per-feature
- A/B тесты промптов

---

## Flow данных (типичный запрос)

```
1. Client → API (HTTP POST /features/X/run)
     ↓
2. API валидирует DTO (class-validator)
     ↓
3. API публикует job в RabbitMQ → возвращает jobId
     ↓
4. Worker забирает job
     ↓
5. Worker вызывает Flowise / Claude напрямую
     ↓
6. Langfuse логирует промпты, токены, стоимость
     ↓
7. Worker пишет результат в Postgres
     ↓
8. Client получает результат (polling / SSE / webhook)
```

---

## Добавление новой фичи

1. Создать `libs/<feature-name>/`
2. Определить модели в `prisma/schema.prisma`
3. Сгенерировать миграции + DTO (`npm run prisma:migrate:dev`)
4. Описать в `docs/features/<feature-name>.md`:
    - Что делает
    - Какие LLM использует
    - Схема данных
    - API-контракт
5. Реализовать:
    - Module / Service / Controller в библиотеке
    - Chatflow в Flowise (если нужен визуальный оркестратор)
    - Handler в `apps/worker` (для асинхронных задач)
6. Покрыть тестами (unit для сервисов, e2e для контроллеров)
7. Подключить в `apps/api/src/app.module.ts`

---

## Roadmap (обновлено 2026-05-02)

- **v0.1** — skeleton, инфра, health check ✅
- **vision-catalog Phase 1 + Phase 2** — поиск по каталогу Aquaphor Pro: text/image/combined, 155 товаров, Vision augmentation на ingest, pre-launch hardening ✅ (2 мая 2026, $0.49 ≈ 39 ₽ за всю разработку, 591 unit-тест). [Фича](../features/vision-catalog-search.md), [исполнительное саммари](../management/vision-catalog-executive-summary.md).
- **vision-catalog Phase 3** — water-analysis: анализ лабораторных результатов воды через Vision (планируется поверх инфры catalog).
- **knowledge-base** — polymorphic ingestion (видео/PDF/текст) + Q&A. Отложена в Phase 3+, реактивация по появлению потребителя ([ADR-006 амендмент](decisions/006-knowledge-base-as-first-feature.md#амендмент-2026-05-02--vision-catalog-как-фактическая-первая-фича)).
- **multi-tenant** — пользователи, JWT, биллинг (шаг к SaaS).
- **public SaaS** — деплой, rate limiting, первые клиенты.

> **Замечание:** изначальный план (v0.2 = water-analysis, v0.3 = notes-rag через knowledge-base) пересмотрен после появления конкретного заказчика на каталог-поиск. Vision-catalog построен standalone без knowledge-base слоя — детали в ADR-006.
