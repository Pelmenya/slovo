# slovo

AI-платформа на NestJS для быстрого прототипирования LLM-фич и их эволюции в production-сервисы.

**Стек:** Node 24 LTS + NestJS 11 + Prisma 7 + PostgreSQL 18 (pgvector) + Valkey 9 + RabbitMQ 4 + Flowise 3 + Langfuse + Claude.

---

## Почему это

Каждая LLM-фича проходит 3 стадии:

1. **Эксперимент** — что-то собрать за вечер, проверить гипотезу
2. **Прототип** — причесать логику, добавить тесты, показать кому-то
3. **Production** — rate limiting, мониторинг, rollout, оплата

Обычно эти стадии требуют **трёх разных стеков**. Здесь всё в одном проекте, переход между стадиями — плавный.

## Статус

Active development. Не готово к production.

---

## Быстрый старт

**1. Инфраструктура:**
```bash
cp .env.example .env
npm install
npm run infra:up                 # Postgres / Valkey / RabbitMQ / Flowise
npm run tools:up                 # pgAdmin / Redis Commander (опционально)
npm run langfuse:up              # LLM observability (опционально)
```

**2. Миграции:**
```bash
npm run prisma:migrate:dev       # создаст БД slovo
```

**3. Запуск:**
```bash
npm run start:dev                # API (порт 3101)
npm run start:worker:dev         # Worker (RabbitMQ consumer)
```

**4. Проверка:**
- API health: http://localhost:3101/health
- Swagger docs: http://localhost:3101/api/docs
- Flowise: http://localhost:3130
- pgAdmin: http://localhost:5050
- Langfuse: http://localhost:3100

---

## Структура

```
slovo/
├── apps/
│   ├── api/                    # NestJS HTTP API
│   └── worker/                 # RabbitMQ consumer (долгие задачи)
├── libs/
│   ├── common/                 # DTO, errors, interceptors
│   ├── database/               # Prisma + сгенерированные DTO
│   └── llm/                    # Абстракция LLM-провайдеров
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── init/                   # SQL для pgvector extensions
├── docker-compose.infra.yml    # Базовая инфраструктура
├── docker-compose.tools.yml    # Dev UIs
├── docker-compose.langfuse.yml # LLM observability
└── docs/
    ├── architecture/
    │   ├── overview.md
    │   └── decisions/          # ADR (Architecture Decision Records)
    ├── features/               # Документы по фичам
    └── tutorial/               # Пошаговое изучение стека
```

---

## Документация

- [Архитектура](docs/architecture/overview.md)
- [Architecture Decision Records](docs/architecture/decisions/)
- [Фичи](docs/features/)

---

## Лицензия

UNLICENSED — пока личный проект.
