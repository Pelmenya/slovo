# CLAUDE.md — контекст для Claude Code

> Этот файл автоматически читается Claude Code при каждом запуске в проекте slovo.
> Содержит контекст разработчика, принципы проекта и историю архитектурных решений.

---

## Про разработчика

**Технический бэкграунд:**

- PhD по системному анализу — интервальный анализ и моделирование системных связей.
- Fullstack: NestJS, Next.js, React, TypeScript, PostgreSQL, Docker.
- Production-опыт интеграции OpenAI API (CRM для водоочистки — анализ воды, подбор оборудования).
- Опыт парсинга 157k отелей с Puppeteer + pgvector + PostgreSQL full-text search (tsvector).

**Математический фундамент:** embeddings, метрики расстояния, PCA, кластеризация, интервальный анализ — глубоко на уровне PhD.

**Современный AI-стек:** Claude SDK, Flowise, MCP (PostgreSQL MCP, Custom MCP), Tool Agents, RAG, structured output, function calling.

**Контекст работы:** slovo — pet-project с прицелом на SaaS, пилится после основной работы, без дедлайнов. Объяснять можно сразу глубоко (математика, RAG, distributed systems) — не упрощай.

---

## Про проект

**Цель:** универсальная AI-платформа для прототипирования LLM-фичей и их эволюции в production. Планируется как фундамент будущего SaaS.

**Первые фичи в roadmap:**

1. **knowledge-base** — первая и основная фича (ADR-006): загрузить свои источники (видео/текст/PDF) → chunks + embeddings в pgvector → поиск и Q&A по ним. Она же — core capability для всех следующих domain-фич. План: `docs/features/knowledge-base.md`. Транскрибация видео через Groq Whisper — один из ingestion-адаптеров, не отдельная фича.
2. **notes-rag** — Q&A endpoint поверх knowledge base, первая demo domain-фича (Phase 3 плана knowledge-base).
3. **water-analysis** — анализ лабораторных результатов воды через Claude Vision + методология лаборатории из knowledge base. Domain-фича поверх готового слоя.
4. **multi-tenant** — пользователи, JWT, биллинг (шаг к SaaS). Параллельно с первыми фичами, для каждой закладываем `userId` в модели с нуля.

---

## Технические предпочтения

### Стиль кода

- **Отступы: 4 пробела** везде — это строгое предпочтение разработчика
- ESLint + Prettier с конфигами в проекте
- TypeScript strict mode
- **`any` запрещён полностью** — ESLint настроен на `error` для `@typescript-eslint/no-explicit-any` + весь набор `no-unsafe-*` (argument/assignment/call/member-access/return). Использовать точные типы, в крайнем случае — `unknown` с narrow-проверкой (`typeof`, `instanceof`, type guards). `as unknown as X` / `@ts-ignore` / `@ts-expect-error` без обоснования — флагаются агентом.
- **Только `type`, никаких `interface`** — ESLint: `consistent-type-definitions: ['error', 'type']`. Один синтаксис вместо двух, `type` поддерживает unions / intersections / computed nativно. `interface X extends Y` → `type TX = TY & {...}`. Declaration merging (единственное что может только interface) у нас не используется.
- **Все типы с префиксом `T`** — `TAppEnv`, `THealthResponse`, `TLLMProvider`. ESLint: `naming-convention` → typeAlias prefix `T`. C#-style, позволяет глазом отличать тип от класса/переменной в импортах. Исключение: если когда-то понадобится тип из сторонней либы которая уже экспортирует без префикса — можно алиасить через `import type { Foo as TFoo } from 'lib'`.
- **Файлы чистых типов — префикс `t-` (kebab-case)** — если файл содержит ТОЛЬКО type definitions (без валидатора, схемы, логики), имя `t-<domain>.ts`: `t-app-env.ts`, `t-source-adapter.ts`. Если в файле смешано (type + валидатор / type + сервис) — обычное имя (`env.schema.ts`, `source-adapter.ts`). Правило на будущее — сейчас таких файлов нет.
- Вся валидация через class-validator + @nestjs/swagger (двойные декораторы на DTO)

### Коммит-сообщения

- **На русском** — разработчик предпочитает
- Формат: краткая суть в первой строке, детали списком ниже
- Co-Authored-By подписи приветствуются при парной работе

### Pre-commit

Husky запускает `npm run lint` + `npm test` перед каждым коммитом. Если тесты падают — коммит не проходит. Важно не обходить это флагом `--no-verify` без явного указания.

### Тесты — покрываем максимально

**Принцип:** любой новый код по умолчанию покрывается тестами. Исключения — только там, где тестирование технически невозможно (прямые вызовы внешних API без фейков, CLI-обёртки поверх tooling). Если пишешь фичу без тестов — обоснуй в PR почему.

**Почему это критично для slovo:**

1. **Защита от регрессий** — код пилится вечерами, без тестов через полгода не вспомнишь контекст и будешь бояться трогать свой же код.
2. **Живая документация поведения** — тесты показывают *как* метод реально используется, какие кейсы важны (happy/edge/error), какие контракты неявны в сигнатуре. Имена и типы всего не передают.
3. **Контекст для Claude и других ассистентов** — когда AI-инструмент (Claude Code, GitHub Copilot, review-агенты) читает код, чтобы что-то починить или расширить, `*.spec.ts` рядом с сервисом даёт **значительно** больше пользы, чем комментарии. Тесты исполняемы, не лгут, не устаревают (если прогоняются в pre-commit). Это напрямую улучшает качество генерируемого кода.
4. **Рефакторинг без страха** — самое ценное, что дают тесты. Когда покрытие высокое, смена внутренней реализации (например, `Prisma findMany` → raw SQL с pgvector-индексом) — это секунды мысли, а не часы нервов.

**Что обязательно тестируется:**

- **Services** — unit-тестами с мок-зависимостями через `Test.createTestingModule()` + `.overrideProvider().useValue({})`. Покрываем happy-path + edge-кейсы + каждую ошибочную ветку (каждый `throw new XxxException`).
- **Controllers** — тонкий слой, но валидация DTO (через `ValidationPipe`), guards, response shape — проверяются через unit или через e2e.
- **Pure utilities** (libs/common) — 100% покрытие, легко, tests-first.
- **Prisma-запросы с нетривиальной логикой** (raw queries, `$transaction`, фильтры, pgvector-поиск) — integration-тесты с реальной Postgres (через testcontainers или dev-БД со срытой тест-схемой). Моки здесь дают ложную уверенность.
- **LLM-сервисы** — мокаем `@anthropic-ai/sdk` клиент. Проверяем: правильная модель, правильный `cache_control`, корректная обработка `tool_use` блоков, retry на 429, обработка RateLimitError.

**E2E (`apps/api/test/`):**

- Каждый HTTP-эндпоинт — хотя бы smoke-тест (200 happy-path + 400 на невалидном input + 401 если под guard'ом).
- `supertest` уже установлен, конфиг `jest-e2e.json` на месте.

**Покрытие:** `npm run test:cov`. Цель для `apps/` и `libs/` — **≥ 80% lines** к моменту первого прод-релиза. Сейчас стартовый проект — покрытие растёт по мере добавления фич.

**Когда запускать:**

- Во время работы над фичей — `npm run test:watch` на изменяемых файлах.
- Перед каждым коммитом — husky прогоняет автоматически.
- Перед мержем — ручной `npm run test:cov` и проверка, что coverage не упал.

**Антипаттерны:**

- Тест ради теста (`expect(result).toBeDefined()`) — флаг.
- Тест, который мокает всё (включая то, что проверяет) — флаг, он ничего не проверяет.
- Отключать тесты через `test.skip` / `xtest` без TODO-комментария — флаг.

### Prisma schema — multi-file

Используем **`prismaSchemaFolder`** (стабильна в Prisma 7). Схема разнесена по файлам в `prisma/schema/`, путь задан в `prisma.config.ts` (`schema: 'prisma/schema'`).

**Структура:**

```
prisma/schema/
├── main.prisma            # generator client + generator nestjsDto + datasource
├── health.prisma          # HealthCheck + HealthCheckStatus enum
├── user.prisma            # (будет)
├── water-analysis.prisma  # (будет)
└── notes-rag.prisma       # (будет)
```

**Правила:**

- В `main.prisma` — только `generator` и `datasource`, никаких моделей.
- Один `.prisma` файл = один домен (один feature). Группируй модели по бизнес-сущности, не по техническому типу (плохо: `models.prisma`, `enums.prisma`; хорошо: `user.prisma`, `water-analysis.prisma`).
- Enum'ы и связанные модели — в одном файле с их "хозяином" (`HealthCheckStatus` лежит рядом с `HealthCheck`).
- Relations между файлами работают автоматически — Prisma склеивает все `.prisma` файлы в одну логическую схему перед валидацией.
- Имя файла — kebab-case, совпадает с именем домена (`water-analysis.prisma`, а не `waterAnalysis.prisma`).
- `prisma-generator-nestjs-dto` совместим с multi-file — DTO генерируются по именам моделей, независимо от распределения по файлам.

**Как добавить новую фичу:**

1. Создать `prisma/schema/<feature>.prisma`
2. Описать модели (+ enum'ы, если фича-специфичные)
3. `npm run prisma:generate` — сгенерит клиент и DTO в `libs/database/src/generated/<feature>/`
4. `npm run prisma:migrate:dev --name add_<feature>` — миграция

### Prisma миграции — forward-only

У Prisma **нет `down()`** как в TypeORM — миграции всегда применяются вперёд. Это осознанный дизайн.

- **Dev:** изменил схему → `npm run prisma:migrate:dev -- --name <что>`. Сбросить БД — `npx prisma migrate reset` (сносит данные, в AI-сессии требует `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`).
- **Prod:** `npx prisma migrate deploy`. Откат = новая revert-миграция с обратными изменениями (а не правка истории). Перед деплоем — автоматический `pg_dump` в CI/CD, `pg_restore` если что.
- **Разрушающие операции** (`DROP COLUMN`, `ALTER COLUMN TYPE`): обычно безопаснее разбить на 3 миграции (add → backfill → drop), чем делать одной.
- **Ручной SQL** в migration.sql (нужен для HNSW-индекса pgvector, сложных CTE) — через `migrate dev --create-only`, правка файла, потом `migrate dev`. В PR обязательно описать ручную часть.

Полные правила — в `docs/architecture/decisions/005-prisma-with-pgvector.md` → «Миграции — только forward».

---

## Архитектурные решения (ADR)

Все важные решения задокументированы в `docs/architecture/decisions/`. Перед предложением изменений проверь там — возможно решение уже обсуждалось.

1. **ADR-001** — Modular Monolith (не микросервисы)
2. **ADR-002** — PostgreSQL + pgvector (не Pinecone/Qdrant)
3. **ADR-003** — RabbitMQ (не BullMQ)
4. **ADR-004** — Claude как primary LLM (абстракция под OpenAI/Ollama)
5. **ADR-005** — Prisma + raw queries для pgvector
6. **ADR-006** — Knowledge Base как первая фича и core capability (🟡 в обсуждении)
7. **ADR-007** — Catalog ingest contract (file-based pull через MinIO bucket, амендмент 2026-04-30 про bucket→Flowise через slovo orchestrate)
8. **ADR-008** — MCP-сервер для Flowise (self-built в monorepo, амендмент 2026-04-30 про scope 54→66 tools и план extract в отдельные репозитории `mcp-flowise` + `flowise-flowdata`)

При любом пересмотре — создать новый ADR, старый пометить `Устарело` или `Заменено на ADR-XXX`.

### Технический долг

`docs/architecture/tech-debt.md` — список отложенных hardening-задач (валидация env в prod, pino redact, throttle auth/LLM, pool tuning, Swagger в prod и т.д.). Перед PR в соответствующие зоны — сверяться со списком.

### Flowise vs NestJS — что делаем где

Flowise поднят в `docker-compose.infra.yml` на `127.0.0.1:3130`. Роль (после пересмотра 2026-04-22 + Phase 0 эксперимента): **LLM runtime + RAG-orchestration слой**. Управление и orchestration — через REST API, не UI вручную (см. ниже).

Полный разбор «что можно в Flowise, что руками» — в `docs/guides/flowise-vs-nestjs.md`. Референс-тьюториал — `~/Desktop/test-marpla/docs/tutorial/` (5 уровней).

**Правило при отладке Flowise:** официальная документация (docs.flowiseai.com) **не покрывает всё** — особенно нюансы механики chain-нод и API override. При непонятном поведении — **сразу лезь в исходник** через `docker exec slovo-flowise sh -c "cat /usr/local/lib/node_modules/flowise/dist/routes/<feature>/index.js"` или `node_modules/flowise-components/nodes/<category>/<name>/`. На догадки по UI / issues теряется от часа до целого дня, исходник даёт ответ за 5 минут.

### Правило использования MCP-инструментов (главное)

В slovo и связанных проектах подключены MCP-серверы — они дают мне typed tools для частых операций. **Если задача попадает в зону покрытия MCP-сервера — используй его, не bash/curl/REST по памяти.** Каждый ритуал «curl с bearer-token, parse JSON, retry на 429, format error» уже вшит в tool с happy-path + error case покрытием. Меньше boilerplate в моих ответах, меньше шансов забыть `--noproxy '*'` или нагадить с escape'ами.

**Доступные MCP-серверы:**

| Сервер | Префикс tools | Область | Когда использовать |
|---|---|---|---|
| `flowise-slovo` | `mcp__flowise-slovo__*` | 66 tools — Document Stores / Chatflows / Predictions / Credentials / Variables / Custom Tools / Assistants / Composite helpers | Любая работа с Flowise REST. См. ниже подсекцию «MCP-арсенал для работы с Flowise». |
| `playwright` | `mcp__playwright__*` | browser automation — navigate / click / type / screenshot / evaluate / network | UI debugging (Flowise / Swagger / pgAdmin / Redis Commander / Langfuse / прод-сайты), скрейпинг docs/npm/Docker Hub, визуальные баги. См. ниже подсекцию «Playwright MCP». |
| `pencil` | `mcp__pencil__*` | редактор `.pen` design-файлов | Только если разработчик упомянул `.pen` файл или явно попросил работу с Pencil. |

**Decision tree при выборе подхода:**

1. Есть ли MCP-tool на эту задачу? → используй его.
2. Нет, но это **повторяющаяся** ритуальная операция (≥2 раза за сессию)? → проверь `flowise_introspect` / explore Flowise REST source, если оправдано — добавь tool в `apps/mcp-flowise/` (gate-критерии в подсекции ниже).
3. Нет, и это разовая разведка (один curl чтобы посмотреть headers) → bash / `fetch` в `experiments/` ОК.
4. UI-задача, Swagger/Flowise dialog, прод-сайт → Playwright MCP.

**Когда МЕНЬШЕ предпочитать MCP:**

- Tool заметно медленнее эквивалентной команды (Playwright: navigate→click→fill это секунды, ровно тот же result через `fetch` — 200ms). Для тестирования endpoint'а — direct fetch.
- В `experiments/` где скрипт сам пишется и runtime контролируется — direct fetch / pg-client ок (как в `run-orchestrate.mjs`).

### MCP-арсенал для работы с Flowise

**Используй `mcp__flowise-slovo__*` tools, не curl/bash.** Любой ручной curl-ритуал к Flowise REST (`--noproxy '*' -X POST -H "Authorization: Bearer..."`) — **антипаттерн**. Все операции есть готовыми типизированными tools.

**Чего нет в арсенале — дописываем в `apps/mcp-flowise/`, не обходим через curl** — но с **gate** против scope-creep.

**Когда добавлять tool оправдано:**
- Endpoint будет использоваться в slovo runtime (`apps/api`/`apps/worker`).
- Закрывает повторяющийся manual-curl ритуал в lab journal'ах / dev-сессиях.
- Закрывает категорию операций (например, обнаружили что `marketplaces/*` нужен — добавляем 2-3 tools одной категорией).

**Когда НЕ добавлять (одноразовая разведка):**
- Один раз посмотреть какие fields в response — `flowise_introspect` / прямой `fetch` в эксперимент-скрипте `experiments/`. Не плодит баггедж в публичном пакете при extract.
- Тестирование незакрытого endpoint'а Flowise (новые beta-фичи) — через `experiments/`, после стабилизации — добавляем tool.

**Если решено добавлять — рутинный путь:**

1. Не нашёл нужный tool среди 66 — **проверь** через `flowise_introspect` / разведку Flowise REST в исходнике (`docker exec slovo-flowise sh -c "cat /usr/local/lib/node_modules/flowise/dist/routes/<feature>/index.js"`).
2. Endpoint реален + проходит gate → **добавь tool**: новый файл `apps/mcp-flowise/src/tools/<resource>.ts` (или расширь существующий) + endpoints.ts + регистрация в `tools/index.ts` + spec-файл с happy + error case через `setupFetchMock` helper. ~50 LOC + ~30 LOC теста.
3. Smoke через `tools/list` (должен вернуть N+1 tools), commit, push.
4. После рестарта Claude Code новый tool готов к использованию.

Стоимость добавления tool'а кратно меньше чем maintenance curl-ритуалов в lab journal'ах при оправданности по gate.

**`apps/mcp-flowise/`** (`@slovo/mcp-flowise`) — **66 tools**, полное зеркало Flowise REST API:

| Категория | Что есть |
|---|---|
| **Document Stores (22)** | CRUD + chunks + loader (save/process/preview/delete) + vectorstore (query/save/insert/update/delete) + components discovery (loaders/embeddings/vectorstore/recordmanager) + generate_tool_desc |
| **Chatflows (6)** | list/get/get_by_apikey/create/update/delete (с опц. `includeFlowData`) |
| **Nodes discovery (2)** | list/get — детальная schema 301 ноды Flowise (для chatflow_create) |
| **Predictions (1)** | run с uploads (base64 image/audio для vision-флоу), history, overrideConfig, form (AgentFlow V2) |
| **Vector (1)** | upsert для legacy chatflows со встроенным vector store узлом |
| **Credentials/Variables/Custom Tools/Assistants (5/4/5/5)** | Full CRUD каждого |
| **Composite (3)** | `chatflow_clone` (get→modify→create), `docstore_clone` (config copy для A/B), `docstore_full_setup` (атомарный 5-step onboarding) |
| **DX helpers (3)** | `introspect` (overview всего instance в одном вызове), `smoke` (per-step latency), `docstore_search_by_name` (find by name) |
| **Misc (4)** | ping, attachments_create, chatmessage (list/abort/delete_all), upsert_history (list/patch_delete) |

**`libs/flowise-flowdata/`** (`@slovo/flowise-flowdata`) — типизированный builder для chatflow flowData JSON. Используется когда нужно создать Chatflow программно через `flowise_chatflow_create`:

```ts
import { buildChatflow, serializeFlowData, chatAnthropic, openAIEmbeddings,
         postgresVectorStore, bufferMemory, conversationalRetrievalQAChain
       } from '@slovo/flowise-flowdata';

const flowData = serializeFlowData(buildChatflow({
    nodes: [
        chatAnthropic({ id: 'llm', credential: 'cred-id', inputs: { modelName: 'claude-sonnet-4-6' }}),
        // ... другие ноды
    ],
    edges: [
        { source: 'emb', target: 'pg', targetAnchor: 'embeddings' },
        // ... связи через typed handles
    ],
}));
// flowData готов для flowise_chatflow_create
```

10 typed factories для частых нод (chatAnthropic, openAIEmbeddings, postgresVectorStore, conversationalRetrievalQAChain, bufferMemory, jsonFile, s3File, и др.) + `fromIntrospection(spec, inputs)` fallback для всех 200+ нод через MCP `nodes_get` runtime introspection.

**Документация:**
- ADR-008 — обоснование self-built MCP, сравнение с community-вариантами, план extract в отдельные репозитории + npm/Smithery publish.
- `apps/mcp-flowise/README.md` — полные примеры по каждой группе tools.
- Lab journal: `docs/experiments/vision-catalog/2026-04-29-document-store-vector-pipeline.md` — reproducible recipe всех ритуалов которые этот MCP заменяет.

### Playwright MCP — браузер для всех задач где нужен браузер

Глобально установленный (`scope=user`, `~/.claude.json`) MCP-сервер для работы с браузером — изолированный chromium instance (не твоя живая сессия). Использую вместо просьбы скриншотов от разработчика, для всех задач где требуется браузер.

**Когда использовать (broad-usage):**

- **UI debugging** — Flowise UI (3130) для нод chatflow / credentials, Swagger UI (3101/api/docs) для проверки эндпоинтов и DTO, pgAdmin (5050), Redis Commander (8081), Langfuse (3100), MinIO Console (9011). Закрывает gap «не всё покрывается mcp__flowise-slovo__* — особенно кнопки/dialog'и/визуальный layout».
- **Live smoke endpoints** — открыть Swagger UI, отправить POST через `browser_evaluate` с `fetch()`, увидеть response. Так нашли broken metadata в PR7 → решение PR6.5 (slovo-orchestrate). Mocked unit-тесты не ловят такие интеграционные баги.
- **Скрейпинг docs / npm / Docker Hub / GitHub Issues** — вместо полагания на память про версии или fix dates. См. правило «всегда проверяй актуальные версии».
- **Прод-проверка** `aquaphor-pro.store`, внешних API-консолей, чужих демо-инсталляций.
- **Визуальные баги фронта** — рендеринг карточек товаров, layout breakpoints, console errors. Когда `prostor-app` подключится — Playwright станет основным debug-tool.

**Когда НЕ использовать:**

- Если есть MCP-tool на ту же задачу — предпочитай его. Flowise REST → `mcp__flowise-slovo__*`, не Playwright (UI всегда медленнее API на порядок).
- Тестовые сценарии для CI — это `apps/api/test/*.e2e-spec.ts` через supertest, не браузер. Playwright — для разовых проверок в dev.
- Простые `fetch` вызовы которые легко проверить через `experiments/*.mjs` — direct fetch ок (как `run-orchestrate.mjs`).

**Известные нюансы:**

- Browser session иногда дисконнектится между tool-call'ами — после `Target page has been closed` сделай `mcp__playwright__browser_close` + `browser_navigate` заново. Не паника, перезапуск стабилен.
- Snapshot'ы (`browser_snapshot`) сохраняются в `.playwright-mcp/` — gitignored, локальные временные. Не пушим.

**Установка** (один раз, scope=user — глобально для Claude Code):

```powershell
# 1. Скачать chromium binary (~170MB)
npx playwright install chromium

# 2. Зарегистрировать MCP-сервер глобально
claude mcp add playwright --scope user -- npx -y @playwright/mcp@latest

# 3. Проверить что connected
claude mcp list

# 4. Перезапустить Claude Code
```

После рестарта появятся `mcp__playwright__browser_navigate`, `..._click`, `..._screenshot`, `..._evaluate`, `..._console_messages`. Whitelist в `~/.claude/settings.json`:

```json
{
    "permissions": { "allow": ["mcp__playwright__*"] }
}
```

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

- PostgreSQL **18** + pgvector **0.8.2** (образ `pgvector/pgvector:0.8.2-pg18-trixie`)
- Valkey **9-alpine** (Redis-compatible, BSD-3 license)
- RabbitMQ **4.2.5-management-alpine**
- Flowise **3.1.2** (визуальный оркестратор)
- Langfuse **3.169.0** (LLM observability)
- pgAdmin **9.14.0** + Redis Commander (dev UI)

**Всегда проверяй актуальные версии перед установкой** — не полагайся на память, посмотри `npm view <pkg> version` и Docker Hub.

---

## Ревью после каждого PR — правило рефлекса

После каждого успешного `git push` Claude **без напоминания** спавнит ревью-агентов параллельно (одним сообщением, `Agent` tool с `run_in_background: true`) на diff `origin/main..HEAD` (или диапазон последних коммитов этого PR):

1. **architect-reviewer** — ADR compliance, границы модулей, тех-выборы
2. **nestjs-code-reviewer** — TS/NestJS стиль, DTO, валидация, тесты
3. **prisma-pgvector-reviewer** — Prisma schema, миграции, индексы (**опускать если Prisma/БД не затронуты**)
4. **llm-integration-reviewer** — Anthropic SDK, prompts, caching (**опускать если libs/llm не затронут**)
5. **security-auditor** — секреты, PII, injection, IAM
6. **testing-specialist** — для пишущих задач: написать недостающие spec'и, добить покрытие модуля. На review — флагает критичные пробелы покрытия. Запускать когда есть новый код без тестов или явный запрос «напиши тесты на X».

По мере завершения агенты отдают находки — Claude сводит в сводный отчёт (🔴 / 🟡 / 🟢 / ✅ / следующие шаги) и предлагает порядок исправлений.

**Чего НЕ делаем:**

- ❌ Hook'и на `PostToolUse` для `git push` — ревью-агенты сами запускают Bash для `git diff`, получается рекурсия. Отвергнуто 2026-04-23 в обсуждении.
- ❌ Ждать когда разработчик скажет `/review`. Это рефлекс Claude, не ручной триггер.
- ❌ Спавнить все 5 агентов на тривиальном коммите (typo, docs, config bump) — 1-2 релевантных достаточно. Решение по размеру diff.

**GitHub Actions /review** — на стадии когда появится PR-workflow с фронтом/командой. Сейчас main-branch, ручной push — правило выше достаточно.

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
- ❌ Писать эмодзи в бизнес-коде, комментариях, docstrings и commit-сообщениях
- ✅ **Исключение:** эмодзи в bootstrap-логах (`🚀 API listening`, `📚 Swagger docs at ...`) и редкие «маячки» в user-facing логах **приветствуются** — разработчик их любит, они улучшают визуальное сканирование dev-консоли. Не убирать
- ❌ Делать деструктивные действия (git reset, force push, rm -rf) без явного разрешения
- ❌ **ASCII-art диаграммы в `.md` документах** (`┌─ │ └` и прочее). GitHub нативно рендерит Mermaid в блоках ` ```mermaid `, а ASCII читается как мусор особенно на мобильных. Для **любой** архитектурной схемы — Mermaid (flowchart / sequenceDiagram / classDiagram / erDiagram). Исключение — крошечные inline-схемы в 3-4 строки внутри bullet-пункта. Всё что больше — Mermaid.

### Ценится

- ✅ Выявление багов до того как они всплывут (например, пробелы в env, невалидные URL)
- ✅ Объяснение математической/архитектурной сути понятным языком
- ✅ Ссылки на документацию первоисточников
- ✅ Таблицы для сравнения альтернатив
- ✅ Mermaid-диаграммы для архитектуры (flowchart / sequenceDiagram / classDiagram / erDiagram)

---

## История (предыдущий проект test-marpla)

До slovo был тестовый проект `test-marpla` (SEO-генератор товаров через Flowise + NestJS). В процессе пройден tutorial по Flowise (уровни 1-5):

- Основы Flowise (Chatflow, Prompt Template, LLM Chain, Structured Output Parser)
- Memory (Buffer / Window / Summary / Persistent)
- RAG (full-text vs pgvector, chunking, top-K, re-ranking, Conversational Retrieval QA)
- Анализ данных с embeddings (PCA, UMAP, HDBSCAN)
- Tool Agents + MCP (PostgreSQL MCP, работа с БД через агента)

Tutorial лежит в `~/Desktop/test-marpla/docs/tutorial/` — при желании можно перенести в `slovo/docs/tutorial/`.

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

Перед реализацией новой фичи — всегда создавать `docs/features/<feature>.md` с планом (по образцу `docs/features/seo-generator.md` из предыдущего проекта `test-marpla`).

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
