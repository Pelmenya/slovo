# CLAUDE.md — контекст для Claude Code

> Этот файл автоматически читается Claude Code при каждом запуске в проекте slovo.
> Содержит контекст разработчика, принципы проекта и историю архитектурных решений.

---

## Про разработчика

**Имя:** Дмитрий Ляпин (GitHub: [Pelmenya](https://github.com/Pelmenya))

**Технический бэкграунд:**

- Кандидат технических наук (05.13.01 — Системный анализ, МГУПИ, 2006)
- Кандидатская под научным руководством С. П. Шарого по интервальному анализу и моделированию системных связей (диссертация в библиотеке ИВМиМГ СО РАН)
- Fullstack-разработчик: NestJS, Next.js, React, TypeScript, PostgreSQL, Docker
- Production-опыт интеграции OpenAI API (проект CRM Aqua Kinetika — анализ воды, подбор оборудования)
- Опыт парсинга 157k отелей с Puppeteer + pgvector + PostgreSQL full-text search (tsvector)

**Математический фундамент:** embeddings, метрики расстояния, PCA, кластеризация, интервальный анализ — глубоко на уровне PhD.

**Современный AI-стек:** Claude SDK, Flowise, MCP (PostgreSQL MCP, Custom MCP), Tool Agents, RAG, structured output, function calling.

**Текущий статус:** 45 лет, семья (дети, пожилые родители), основная работа в найме. Проект slovo — pet-project с прицелом на SaaS. Пилит по мере наличия времени, без дедлайнов. Есть финансовая подушка на старте.

---

## Про проект

**Цель:** универсальная AI-платформа для прототипирования LLM-фичей и их эволюции в production. Планируется как фундамент будущего SaaS.

**Первые фичи в roadmap:**

1. **water-analysis** — анализ лабораторных результатов воды через Claude Vision, подбор оборудования (эволюция из CRM Aqua)
2. **notes-rag** — "спроси у моих заметок", RAG над личными документами
3. **multi-tenant** — пользователи, JWT, биллинг (шаг к SaaS)

---

## Технические предпочтения

### Стиль кода

- **Отступы: 4 пробела** везде — это строгое предпочтение разработчика
- ESLint + Prettier с конфигами в проекте
- TypeScript strict mode
- Избегать `any`, использовать точные типы
- Вся валидация через class-validator + @nestjs/swagger (двойные декораторы на DTO)

### Коммит-сообщения

- **На русском** — разработчик предпочитает
- Формат: краткая суть в первой строке, детали списком ниже
- Co-Authored-By подписи приветствуются при парной работе

### Pre-commit

Husky запускает `npm run lint` + `npm test` перед каждым коммитом. Если тесты падают — коммит не проходит. Важно не обходить это флагом `--no-verify` без явного указания.

---

## Архитектурные решения (ADR)

Все важные решения задокументированы в `docs/architecture/decisions/`. Перед предложением изменений проверь там — возможно решение уже обсуждалось.

1. **ADR-001** — Modular Monolith (не микросервисы)
2. **ADR-002** — PostgreSQL + pgvector (не Pinecone/Qdrant)
3. **ADR-003** — RabbitMQ (не BullMQ)
4. **ADR-004** — Claude как primary LLM (абстракция под OpenAI/Ollama)
5. **ADR-005** — Prisma + raw queries для pgvector

При любом пересмотре — создать новый ADR, старый пометить `Устарело` или `Заменено на ADR-XXX`.

---

## Стек (версии на апрель 2026)

**Runtime:**

- Node.js **24.15.0 LTS** (Krypton)
- npm **11.12.1**
- TypeScript **6.0.3**

**Framework:**

- NestJS **11.1.19** (monorepo через npm workspaces)
- Prisma **7.7.0** + prisma-generator-nestjs-dto **1.1.4**

**LLM:**

- @anthropic-ai/sdk **0.90.0** (primary)
- Модели по умолчанию: `claude-sonnet-4-6` (основная), `claude-haiku-4-5` (fast)
- Embeddings: OpenAI `text-embedding-3-small` (опционально Cohere multilingual)

**Infrastructure:**

- PostgreSQL **17** + pgvector **0.8.2** (образ `pgvector/pgvector:0.8.2-pg17-trixie`)
- Valkey **8-alpine** (Redis-compatible, BSD-3 license)
- RabbitMQ **4.2.5-management-alpine**
- Flowise **3.1.2** (визуальный оркестратор)
- Langfuse **3.169.0** (LLM observability)
- pgAdmin **9.14.0** + Redis Commander (dev UI)

**Всегда проверяй актуальные версии перед установкой** — не полагайся на память, посмотри `npm view <pkg> version` и Docker Hub.

---

## Принципы взаимодействия

### От Claude ожидаются

- **Краткость** — без водянистых объяснений и воды. Отвечать по делу
- **Честность про ограничения** — если не знаешь точной версии, проверь онлайн
- **Проверка фактов** — WebFetch к docs / npm / Docker Hub вместо памяти
- **Признание ошибок** — если ошибся (например, неправильно назвал стек), сразу поправить
- **Не льстить** — не преувеличивать качество работы разработчика
- **Практичность** — избегать overengineering, premature optimization, preexisting YAGNI

### Чего избегать

- ❌ Городить микросервисы где хватает modular monolith
- ❌ Добавлять зависимости "на всякий случай"
- ❌ Генерировать код "лишь бы было", без явной цели
- ❌ Писать эмодзи в код/коммиты без просьбы
- ❌ Делать деструктивные действия (git reset, force push, rm -rf) без явного разрешения

### Ценится

- ✅ Выявление багов до того как они всплывут (например, пробелы в env, невалидные URL)
- ✅ Объяснение математической/архитектурной сути понятным языком
- ✅ Ссылки на документацию первоисточников
- ✅ Таблицы для сравнения альтернатив
- ✅ Mermaid-диаграммы для архитектуры

---

## История (предыдущий проект test-marpla)

До slovo разработчик делал тестовое задание для компании Marpla (SEO-генератор товаров через Flowise + NestJS). Оффер был получен (180к/мес), но отклонён из-за несовместимости режима труда с семейными обязательствами.

В процессе тестового + последующих обсуждений были пройдены tutorial по Flowise (уровни 1-5):

- Основы Flowise (Chatflow, Prompt Template, LLM Chain, Structured Output Parser)
- Memory (Buffer / Window / Summary / Persistent)
- RAG (full-text vs pgvector, chunking, top-K, re-ranking, Conversational Retrieval QA)
- Анализ данных с embeddings (PCA, UMAP, HDBSCAN)
- Tool Agents + MCP (PostgreSQL MCP, работа с БД через агента)

Tutorial лежал в `C:\Users\Diamond\Desktop\test-marpla\docs\tutorial\` — при желании можно перенести в `slovo/docs/tutorial/`.

**Tutorial-шпаргалки в старом проекте:**

- `01-basics.md`, `02-memory.md`, `03-rag.md`, `04-data-analysis.md`, `05-agents.md`

---

## Первая сессия в slovo

Если Claude Code запущен впервые в этом проекте, скорее всего предстоит:

1. Установить зависимости (`npm install`)
2. Поднять инфру (`npm run infra:up`)
3. Запустить первую миграцию Prisma
4. Проверить что API стартует (`npm run start:dev`)
5. Перейти к реализации первой фичи (скорее всего **water-analysis**)

Перед реализацией новой фичи — всегда создавать `docs/features/<feature>.md` с планом (по образцу `docs/features/seo-generator.md` из старого проекта Marpla).

---

## Сокращения, которые встречаются в диалогах

| Сокращение | Значение |
|-----------|----------|
| ADR | Architecture Decision Record |
| RAG | Retrieval Augmented Generation |
| MCP | Model Context Protocol (стандарт Anthropic) |
| CTE | Common Table Expression в SQL |
| HNSW | Hierarchical Navigable Small World (векторный индекс) |
| DTO | Data Transfer Object |
| HMR | Hot Module Replacement |
| SSE | Server-Sent Events |
