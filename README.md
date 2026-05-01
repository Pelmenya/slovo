# slovo

AI-платформа на NestJS для быстрого прототипирования LLM-фич и их эволюции в production-сервисы.

**Стек:** Node 24 LTS + NestJS 11 + Prisma 7 (multi-file schema) + PostgreSQL 18 (pgvector 0.8.2) + Valkey 9 + RabbitMQ 4 + MinIO (S3-compat) + Flowise 3.1.2 + Langfuse 3 + Anthropic Claude + OpenAI Embeddings.

---

## Почему это

Каждая LLM-фича проходит 3 стадии:

1. **Эксперимент** — что-то собрать за вечер, проверить гипотезу
2. **Прототип** — причесать логику, добавить тесты, показать кому-то
3. **Production** — rate limiting, мониторинг, rollout, оплата

Обычно эти стадии требуют **трёх разных стеков**. Здесь всё в одном проекте, переход между стадиями — плавный.

## Статус

**Active development. Phase 1 vision-catalog закрыта (1 мая 2026).**

- ✅ `/catalog/search/text` — semantic search по 155 товарам Аквафор-Pro (~462ms)
- ✅ `/catalog/search/image` — поиск по фото через Claude Vision (~6-7s)
- ✅ `/catalog/search` — universal endpoint (text / image / combined, до 5 фото)
- ✅ Catalog ingest pipeline с RecordManager skip-if-unchanged (95× cost reduction, ~$0/refresh при unchanged)
- ⏳ Phase 2: pre-launch hardening (per-IP throttle, image-cache, webhook-trigger) → запуск на prostor-app
- ⏳ Phase 3: water-analysis (анализ лабораторных результатов воды через Vision)

Реальные расходы за 8 дней Phase 1: $0.18 ≈ 14,4 ₽ (фактический billing OpenAI + Anthropic).

---

## Быстрый старт

**1. Зависимости и env:**
```bash
cp .env.example .env
# Заполнить FLOWISE_API_KEY (после первого запуска Flowise UI), 
# OPENAI_API_KEY, ANTHROPIC_API_KEY, S3_SECRET_KEY
npm install
```

**2. Инфраструктура:**
```bash
npm run infra:up                 # Postgres + pgvector / Valkey / RabbitMQ / MinIO / Flowise
npm run tools:up                 # pgAdmin / Redis Commander (dev UIs)
npm run langfuse:up              # LLM observability (опционально)
```

**3. Миграции:**
```bash
npm run prisma:migrate:dev       # создаст БД slovo
npm run prisma:generate          # клиент + DTO (multi-file schema → libs/database/src/generated/)
```

**4. Запуск:**
```bash
npm run start:dev                # API (порт 3101)
npm run start:worker:dev         # Worker (catalog-refresh cron + RabbitMQ consumer)
```

**5. Проверка:**
- API health: http://localhost:3101/health
- Swagger docs: http://localhost:3101/api/docs
- Flowise: http://localhost:3130 (Document Stores → catalog-aquaphor)
- MinIO Console: http://localhost:9011 (admin/admin)
- pgAdmin: http://localhost:5050
- Langfuse: http://localhost:3100

---

## Структура

```
slovo/
├── apps/
│   ├── api/                          # NestJS HTTP API (catalog/search, knowledge, health)
│   ├── worker/                       # RabbitMQ consumer + catalog-refresh cron
│   └── mcp-flowise/                  # 66 MCP tools для Flowise REST API
├── libs/
│   ├── common/                       # DTO, errors, validators, env-schema
│   ├── database/                     # Prisma client + auto-generated DTO
│   ├── flowise-client/               # Тонкий HTTP-клиент Flowise REST
│   ├── flowise-flowdata/             # Typed builder для chatflow flowData JSON
│   ├── storage/                      # MinIO/S3 client (per-feature через forFeature)
│   └── llm/                          # Абстракция LLM-провайдеров (план — Phase 2)
├── prisma/
│   └── schema/                       # Multi-file: main / health / user / ...
├── docker-compose.infra.yml          # Базовая инфраструктура
├── docker-compose.tools.yml          # Dev UIs
├── docker-compose.langfuse.yml       # LLM observability
└── docs/
    ├── architecture/
    │   ├── overview.md
    │   ├── decisions/                # ADR (8 решений)
    │   └── tech-debt.md              # Hardening-задачи + pre-launch blockers
    ├── features/                     # vision-catalog-search, knowledge-base
    ├── management/                   # Executive summary + handoff (для руководителя/фронта)
    └── experiments/                  # Lab journals + туториал-скриншоты
```

---

## Документация

**Для разработчика:**
- [Архитектура](docs/architecture/overview.md)
- [Architecture Decision Records](docs/architecture/decisions/) — 8 ADR (modular monolith, pgvector, Claude, Prisma + multi-file, knowledge base, catalog ingest, MCP)
- [Технический долг](docs/architecture/tech-debt.md) — pre-launch blockers + roadmap
- [Vision Catalog Search — план фичи](docs/features/vision-catalog-search.md)
- [Flowise vs NestJS — что делаем где](docs/guides/flowise-vs-nestjs.md)
- [`apps/mcp-flowise/README.md`](apps/mcp-flowise/README.md) — 66 MCP tools для Flowise

**Для управления:**
- [Executive summary vision-catalog](docs/management/vision-catalog-executive-summary.md) — экономика, ROI, прогноз
- [Handoff для фронт-команды](docs/management/vision-catalog-handoff.md) — API контракты, UX-нюансы
- [Скриншоты Document Store setup](docs/experiments/vision-catalog/screenshots/document-store-setup/) — визуальный референс настроенной системы

**Для AI-ассистентов:**
- [`CLAUDE.md`](CLAUDE.md) — контекст проекта, технические предпочтения, MCP-арсенал

---

---

## Лицензия

UNLICENSED — пока личный проект.
