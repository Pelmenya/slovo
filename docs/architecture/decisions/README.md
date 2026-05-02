# Architecture Decision Records (ADR)

Каждый значимый архитектурный выбор фиксируется отдельным документом.

## Формат

```
# ADR-NNN: Название

## Статус
Принято / Предложено / Устарело / Заменено на ADR-XXX

## Контекст
Что за проблема, зачем решаем

## Решение
Что выбрали

## Альтернативы
Что ещё рассматривали, почему отказались

## Последствия
Плюсы и минусы выбранного решения
```

## Список

| № | Решение | Статус |
|---|---------|--------|
| [001](001-modular-monolith.md) | Modular Monolith вместо микросервисов | ✅ Принято |
| [002](002-postgres-pgvector.md) | PostgreSQL + pgvector вместо Pinecone/Qdrant | ✅ Принято |
| [003](003-rabbitmq-vs-bullmq.md) | RabbitMQ для асинхронных задач | ✅ Принято |
| [004](004-claude-as-primary-llm.md) | Claude как основная LLM | ✅ Принято |
| [005](005-prisma-with-pgvector.md) | Prisma + raw queries для векторов | ✅ Принято |
| [006](006-knowledge-base-as-first-feature.md) | Knowledge Base как core capability | ✅ Принято · 🟡 амендмент 2026-05-02 (Phase 1 text-MVP закрыта, Phase 2+ отложена; vision-catalog первой закрытой фичей) |
| [007](007-catalog-ingest-via-minio.md) | Catalog ingest contract — file-based pull через shared MinIO bucket | ✅ Принято |
| [008](008-flowise-mcp.md) | MCP-сервер для Flowise (self-built в monorepo) | ✅ Принято |
