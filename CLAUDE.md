# CLAUDE.md — контекст для Claude Code

> Этот файл автоматически читается Claude Code при каждом запуске в проекте slovo.
> Содержит контекст разработчика, принципы проекта и историю архитектурных решений.

---

## Co-agents coordination (Layer 1)

Ты — агент **slovo-backend**. Параллельно в смежных репах могут идти другие Claude Code сессии.

**Shared board:** `C:\Users\Diamond\.claude\AGENT-STATUS.md` — единая точка координации для всех агентов (отдельно от внутрислововской «Активная миграция»-секции ниже).
**Setup doc:** `C:\Users\Diamond\Desktop\multi-agent-setup\multi-agent-setup.md`.

### Sibling agents

| Агент | Репо | Точки касания с slovo-backend |
|---|---|---|
| **prostor-frontend** | `prostor-app/` | потребитель water-analysis API: `/heatmap`, `/predict`, `/depth-map`, `/equipment-suggest`, `/points`, `/aquifer-stats` |
| **slovo-llm-runtime** | `slovo-llm/` | Ollama локальный inference (laguna-xs.2 q4_K_M @ 32K); абстракция Claude/OpenAI/Ollama в `libs/llm` |
| **crm-back** | `crm-aqua-kinetics-back/` | референс на legacy water-analysis (источник 15504 бланков); domain knowledge водоочистки |

### Protocol

**Перед задачей:**
1. Прочитать `~/.claude/AGENT-STATUS.md`
2. Если prostor-frontend прямо сейчас потребляет endpoint, который ты собираешься менять (shape, поля, версию) → **спросить у пользователя**, не запускаться
3. Добавить строку про себя в `## Active` (Agent / Repo / Started / Intent / Touching / ETA / Notes)

**Во время работы:** обновлять intent при milestone'ах.

**После задачи:**
- Перенести строку из `## Active` в `## Completed`
- Если менял API contract (DTO, новый endpoint, Prisma schema, response shape, threshold/коэффициент в predict) → handoff `slovo-backend → prostor-frontend` в `## Recent handoffs` с curl/OpenAPI snippet
- Если менял prompt / модель / параметры Ollama / cost-cap → handoff `slovo-backend → slovo-llm-runtime`

**User (Дмитрий) = mediator on conflicts. Auto-merge cross-repo запрещён.**

> Примечание: секция **«Активная миграция»** ниже — это внутрисловская координация (sliced работа в одном репо). Cross-repo координация — через board выше.

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

**Roadmap фич (актуально на 2026-05-08):**

1. ✅ **vision-catalog-search** (Phase 1 + Phase 2 закрыты 2 мая 2026, ~$0.49 ≈ 39 ₽ за всю разработку, 591 unit-тест) — поиск по каталогу Aquaphor Pro: text / до 5 фото / комбо, Vision augmentation на ingest, pre-launch hardening (per-IP/IPv6-/64 throttle, SHA256 image-cache, budget cap + Telegram alert). Построена **standalone** через Flowise Document Store + `apps/mcp-flowise`, без knowledge-модуля. План: `docs/features/vision-catalog-search.md`. Executive summary: `docs/management/vision-catalog-executive-summary.md`.
2. 🟢 **knowledge-base Phase 1** (text-only MVP закрыт): `prisma/schema/knowledge-base.prisma` + миграции + `apps/api/src/modules/knowledge/` (Controller + Service + DTO + тесты), синхронный text-ingestion endpoint. Phase 2+ (video/audio/PDF/YouTube адаптеры, Flowise upsert, retrieval) отложены до триггера потребителем. План + амендмент: `docs/features/knowledge-base.md`, ADR-006 амендмент 2026-05-02.
3. ✅ **water-analysis** (Этапы 1.A + 1.A.5 + 1.B + Phase 2 + **Phase 4 backend** закрыты 7-8 мая 2026, ~23 750 ₽ extraction + ~$0.29 embeddings = $217.82 Anthropic+OpenAI + Ahunter ≥ 2 000 ₽, **1 179 unit-тестов** в 69 test suites) — 15 504 бланка анализов воды Аквафор-Pro 2020-2026 нормализованы в structured dataset (21 paramCode + единицы + флаги, 97% normalize-clean, 93% holistic accuracy, 95.9% Mg coverage / 99.6-99.8% в свежих 2024-2026 после pdftotext-rescue), embedded через OpenAI text-embedding-3-large (3072 dim) в Flowise Document Store `water-analysis-aquaphor` (Custom Document Loader, 1 loader → 15 504 chunks за 176 секунд / 88 rec/s / $0.29). **Phase 2 endpoint `POST /water-analysis/similar`** — vector search top-K через Flowise vectorstoreQuery (~600ms latency), throttle 60/min/IP, single-flight storeId cache. **Phase 4 backend (8 мая 2026)** — 7 endpoints для prostor-app карты + 4 USP-фичи (карта-first позиционирование):
   - `GET /heatmap` — агрегированная тепловая карта 22 параметров + risk через PostGIS bbox + grid (sub-100мс на МО)
   - `GET /predict` (USP-1) — kNN-прогноз 22 параметров для нового адреса БЕЗ анализа. **Interval-first** (3 уровня: P10-P90 80%, IQR 50%, hardRange 100% + pointEstimate). **4-level pdkStatus** (safe/borderline/concerning/unsafe — interval-aware с median tipping point). `byCategory` pre-grouping для UI shortcut.
   - `GET /depth-map` (USP-4 base) — карта глубин скважин + 5 aquifer-buckets. Audience: B2B drillers (depth_meters coverage 76.7% well + 41.2% well_dug = gold mine).
   - `GET /depth-predict` (USP-4) — interval-first прогноз глубины бурения + mostLikelyAquiferLayer.
   - `GET /points` — individual анализы high-zoom (PII roundCoord 0.005°).
   - `POST /equipment-suggest` (USP-2 flagship) — cross-domain вода→каталог. Per-problem catalog search (PROBLEM_TO_QUERY mapping → targeted RO/обезжелезиватели/умягчители вместо generic). Recommendation содержит `matchedProblem` + `reason` для UI.
   - `GET /aquifer-stats` (USP-4 deep-dive) — стратифицированная chemistry per layer («бури глубже = чище вода»).

   **PII strategy** (memory `feedback_water_heatmap_pii_strategy`): минимальный grid 0.02° для aggregates, roundCoord 0.005° для individual точек, k-anonymity через grid вместо K_MIN. **Interval-first философия** (memory `feedback_interval_first_predictions`): 4-level severity для всех predict-endpoints. Полный план: `docs/features/prostor-water-pivot.md`. План water-pipeline: `docs/features/water-analysis.md`. Executive summary: `docs/management/water-analysis-executive-summary.md`. Docling vs Vision compare: `docs/experiments/water-analysis/2026-05-12-compare-full.md`. Frontend production (Phase 4.5) — следующий шаг, пилится на real backend.
4. ⏳ **notes-rag**: Q&A endpoint поверх knowledge-base — реактивация когда появится потребитель Phase 2 video/PDF-источников.
5. ⏳ **multi-tenant**: пользователи, JWT, биллинг (шаг к SaaS). Параллельно с domain-фичами, для каждой закладываем `userId` в модели с нуля (`KnowledgeSource` уже имеет `userId String? @db.Uuid`).

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
├── water-analysis.prisma  # WaterAnalysisRaw + WaterAnalysis + enums (Этап 1.A + 1.B)
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
- **Drift от Flowise-managed таблиц** (Document Store создаёт `<storeId>_chunks` / `<storeId>_record_manager` через TypeORM вне Prisma migration history) — `migrate dev` будет хотеть `migrate reset`, что сносит данные. Workaround: `migrate diff --from-migrations prisma/migrations --to-schema prisma/schema --script > migration.sql` → положить в `prisma/migrations/<timestamp>_<name>/migration.sql` → применить через `docker exec -i slovo-postgres psql -U slovo -d slovo < migration.sql` → пометить applied через `npx prisma migrate resolve --applied <migration_name>` → `npm run prisma:generate`. Shadow DB `slovo_shadow` уже создана и прописана в `prisma.config.ts` через `SHADOW_DATABASE_URL` — нужна для diff. Прецедент: `20260504072555_add_water_analysis`.

Полные правила — в `docs/architecture/decisions/005-prisma-with-pgvector.md` → «Миграции — только forward».

### Backup БД — два слоя (локально + Yandex.Disk)

Перед любой destructive операцией (migrate reset, массовый ETL, re-extract, re-normalize) или routine snapshot:

```bash
# из корня slovo/
TS=$(date +%Y%m%d_%H%M%S)
docker exec slovo-postgres pg_dump -U slovo -d slovo --format=plain --no-owner --no-acl \
  | gzip > "experiments/water-analysis-dataset/data/backups/slovo_full_${TS}.sql.gz"

# integrity check
gunzip -t "experiments/water-analysis-dataset/data/backups/slovo_full_${TS}.sql.gz"

# ОБЯЗАТЕЛЬНО дублировать в Yandex.Disk (off-machine sync)
cp "experiments/water-analysis-dataset/data/backups/slovo_full_${TS}.sql.gz" \
   "C:/Users/Diamond/YandexDisk/Water_backup/"
```

Два места:
- **Локально** — `experiments/water-analysis-dataset/data/backups/` (gitignored, SSD, быстрый restore)
- **Yandex.Disk** — `C:/Users/Diamond/YandexDisk/Water_backup/` (off-machine, защита от disk failure)

Naming convention: `slovo_full_<YYYYMMDD_HHMMSS>.sql.gz` (полный) / `water_analysis_<TS>.sql.gz` (только водные таблицы, быстрее) / `water_analysis_schema_<TS>.sql` (schema-only для diff).

БД на 12 мая 2026 — **368 MB / 12 tables** (water_analysis, water_analysis_raw, Flowise-managed chunks/record_manager, health_check). Gzipped backup ~224 MB.

Restore-инструкции + история backup'ов: `experiments/water-analysis-dataset/data/backups/README.md`. **Перед restore — обязательно явное согласие пользователя** (затирает всю БД).

---

## Архитектурные решения (ADR)

Все важные решения задокументированы в `docs/architecture/decisions/`. Перед предложением изменений проверь там — возможно решение уже обсуждалось.

1. **ADR-001** — Modular Monolith (не микросервисы)
2. **ADR-002** — PostgreSQL + pgvector (не Pinecone/Qdrant)
3. **ADR-003** — RabbitMQ (не BullMQ)
4. **ADR-004** — Claude как primary LLM (абстракция под OpenAI/Ollama)
5. **ADR-005** — Prisma + raw queries для pgvector
6. **ADR-006** — Knowledge Base как core capability (амендмент 2026-05-02: Phase 1 text-MVP закрыта, Phase 2+ отложена; vision-catalog ушёл вперёд как фактически первая закрытая фича)
7. **ADR-007** — Catalog ingest contract (file-based pull через MinIO bucket, амендмент 2026-04-30 про bucket→Flowise через slovo orchestrate)
8. **ADR-008** — MCP-сервер для Flowise (self-built в monorepo, амендмент 2026-04-30 про scope 54→66 tools и план extract в отдельные репозитории `mcp-flowise` + `flowise-flowdata`)

При любом пересмотре — создать новый ADR, старый пометить `Устарело` или `Заменено на ADR-XXX`.

### Технический долг

`docs/architecture/tech-debt.md` — список отложенных hardening-задач (валидация env в prod, pino redact, throttle auth/LLM, pool tuning, Swagger в prod и т.д.). Перед PR в соответствующие зоны — сверяться со списком.

### Flowise vs NestJS — что делаем где

Flowise поднят в `docker-compose.infra.yml` на `127.0.0.1:3130`. Роль (после пересмотра 2026-04-22 + Phase 0 эксперимента): **LLM runtime + RAG-orchestration слой**. Управление и orchestration — через REST API, не UI вручную (см. ниже).

Полный разбор «что можно в Flowise, что руками» — в `docs/guides/flowise-vs-nestjs.md`. Референс-тьюториал — `~/Desktop/test-marpla/docs/tutorial/` (5 уровней).

**Правило при отладке Flowise:** официальная документация (docs.flowiseai.com) **не покрывает всё** — особенно нюансы механики chain-нод и API override. При непонятном поведении — **сразу лезь в исходник** через `docker exec slovo-flowise sh -c "cat /usr/local/lib/node_modules/flowise/dist/routes/<feature>/index.js"` или `node_modules/flowise-components/nodes/<category>/<name>/`. На догадки по UI / issues теряется от часа до целого дня, исходник даёт ответ за 5 минут.

### Flowise LLM Chain `overrideConfig.promptValues` — РАБОТАЕТ (важно)

**Я забывал это правило дважды.** В Flowise 3.x для LLM Chain `overrideConfig.promptValues` через API **РАБОТАЕТ**. Полный разбор — `docs/guides/flowise-vs-nestjs.md` секция «✅ B. `overrideConfig.promptValues` — ДОКОПАЛИСЬ».

Три условия чтобы работало:

1. **`{input}` обязан быть ПОСЛЕДНЕЙ переменной шаблона.** `question` из API hard-map'ится в last var через `[lastValue]: input` (исходник `LLMChain.ts`). `promptValues` его НЕ перебивает — это auto-map для user-input.
2. **Остальные vars** (`{language}`, `{tenant}`, `{labRegion}`, ...) — пишутся ВЫШЕ `{input}` и подставляются через `overrideConfig.promptValues` в payload.
3. **Security → Override Configuration → `promptValues` toggle включить + Save** в UI chatflow'а ИЛИ в `apiConfig.overrideConfig` при создании через REST. Без toggle API-override игнорируется (дефолт для безопасности).

**Partial vars в UI ноды (Format Prompt Values)** имеют **приоритет** выше API. Для чистого API-override — очистить partial vars в ноде.

Перед утверждением «promptValues в LLM Chain не работает» / «LLM Chain legacy» — обязательно сверить с `docs/guides/flowise-vs-nestjs.md` секция «✅ B». Memory `project_flowise_proxy_bootstrap` содержит pre-update вывод — не использовать как источник правды без верификации.

### Flowise — конвенции нейминга ресурсов

Полные правила — в `docs/guides/flowise-naming.md`. Краткая выжимка обязательная для всех:

- **Chatflows / AgentFlows:** `<domain>-<task>[-<modifier>]-<version>` — `water-analysis-extractor-vision-v1`, `catalog-augmenter-vision-v1`. Domain первым словом всегда (якорь сортировки и фильтрации). Task — существительное на `-er`/`-or` (`extractor`, не `extract`). Modifier (`vision`/`text`/`tool-agent`) — только когда есть параллельные варианты той же task. Version `-vN` обязательно, инкрементально.
- **Document Stores:** `<domain>-<source>` — `catalog-aquaphor`, `knowledge-base-text` (без version, store обычно один).
- **Credentials:** `<provider>-<env>` — `anthropic-prod`, `openai-prod`.
- **Variables:** `UPPER_SNAKE_CASE` (как env vars) — `WATER_ANALYSIS_BUDGET_USD`, `CATALOG_VISION_DAILY_CAP_USD`.
- **Custom Tools:** `<domain>-<action>` — `catalog-search-by-image`, `water-analysis-fetch-similar`.
- **Общие правила:** lowercase, kebab-case, ASCII, singular. Никакой кириллицы, заглавных, точек, эмодзи в именах.

При создании нового ресурса через MCP (`flowise_chatflow_create` / `flowise_credentials_create` и т.д.) — сначала прогнать `flowise_chatflow_list` / `flowise_introspect`, чтобы не плодить конфликт имён.

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

**ОБЯЗАТЕЛЬНО** — visual check после любого `flowise_chatflow_create` / `flowise_chatflow_update` / запуска скрипта который генерит flowData через `@slovo/flowise-flowdata`. REST/MCP `chatflow_get` возвращает структурно корректный JSON, **но это не гарантирует что Flowise UI рисует edges** — handles могут быть broken (handles с пробелами `' | '`, отсутствующее поле `id` в anchors, рассогласование sourceHandle/targetHandle с anchor.id). Прецедент 2026-05-04: water-analysis-extractor-vision-v1 создан, MCP get показал 4 ноды + 3 edges, но в UI edges не было — обнаружили только после Playwright screenshot. См. memory `feedback_visual_check_after_chatflow_create`.

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

## Стек (версии на май 2026)

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
- Embeddings: OpenAI `text-embedding-3-large` 3072 dim — дефолт после апгрейда 2026-05-07 (catalog-aquaphor + water-analysis-aquaphor оба на large; knowledge-base включится при реактивации Phase 2). `text-embedding-3-small` 1536 — legacy/опционально. Cohere multilingual — backup-вариант. Цена large: $0.13/M tokens.

**Infrastructure:**

- PostgreSQL **18** + pgvector **0.8.2** + PostGIS **3.6.3** (кастомный образ `slovo-postgres:pgvector-postgis-pg18`, базис `pgvector/pgvector:0.8.2-pg18-trixie` + `postgresql-18-postgis-3`, см. `docker/postgres/Dockerfile`)
- Valkey **9-alpine** (Redis-compatible, BSD-3 license)
- RabbitMQ **4.2.5-management-alpine**
- Flowise **3.1.2** (визуальный оркестратор)
- Langfuse **3.169.0** (LLM observability)
- pgAdmin **9.14.0** + Redis Commander (dev UI)

**Всегда проверяй актуальные версии перед установкой** — не полагайся на память, посмотри `npm view <pkg> version` и Docker Hub.

---

## Активная миграция — water-analysis Docling extraction (2026-05-12)

🎯 **Заменяем Vision-Haiku extraction на бесплатный детерминированный Docling** в water-analysis ETL.

**Контекст для новой сессии — читать обязательно:**
- `docs/experiments/water-analysis/2026-05-12-docling-migration-HANDOFF.md` — current state, next steps, discoveries
- `docs/experiments/water-analysis/2026-05-12-docling-migration.md` — полный план миграции (slices + progress log)
- `apps/docling/CLAUDE.md` — операционный контекст для самого docling-service

**Status snapshot:**
- ✅ Docling service deployed (CPU + GPU), full 15504 PDF extracted (`data/docling-raw/`)
- ✅ Compare reports готовы (extraction-level, end-to-end, params consistency, SanPiN matrix)
- ✅ **Slice 1 закрыт (2026-05-12)** — lib-only фундамент в `libs/water-blank-extraction/`:
  `WaterBlankExtractionV1` Zod-схема перенесена из experiments, `preCleanName`,
  `docling-table-parser`, `deriveIntakeType` + расширенные `PARAM_SYNONYMS`
  (mg2+/mn2+/ca2+ ASCII, реакция среды ph, цветность град, фториды (f),
  электропроводность воды). **219/219 tests, 0 lint errors.** БД не тронута.
- ✅ **Slice 1.5 закрыт (2026-05-12)** — tuning `deriveIntakeType` на 15504 Vision-labels:
  - **Threshold 25м → 15м** (tuned on label distribution P10=17, P50=47).
  - `parseDepthMeters` bug fix: range support («50-60м» → 55), modifier strip (`>`/`~`).
  - **`deriveIntakeTypeWithSource()`** добавлен параллельно (original API unchanged) —
    возвращает `{ type, source }` для observability (`hint_*` / `depth_*` / `default_municipal`).
  - **Best accuracy: 73.34% (slovo-truth) / 73.60% (domain-truth)** на Strategy C
    (hint + threshold=15). Strategy D (+ dealer-majority) даёт 74.5% но ломает
    municipal-recall (0.96→0.26 — wrong-equipment risk).
  - Target ≥95% **недостижим** без extraction `samplingPoint` из Docling row 3
    handwritten ИЛИ Vision-fallback на ~10% no-depth+no-hint бланков.
  - **240/240 tests** в libs. 14 immutable run-*.json snapshots в `experiments/water-analysis-dataset/data/intake-tuning/`.
- ✅ **Slice 4.2 закрыт (2026-05-12)** — canonical best-of-three merge на 15504:
  `experiments/.../data/canonical/canonical_full.jsonl` (25.2 MB, isolated artifact,
  БД не тронута). Per-field provenance в `_source` + `_diff` для review.
  Docling улучшения: +562 gained depths (3.6%), +47 sampleDate-bugfix,
  +1599 addresses where derived null. 2941 (19%) бланков с param-disagreement —
  кандидаты для re-embed. intakeType 100% derived (Vision checkbox), appearance
  98% docling (richer multi-checkbox). Decision matrix в migration.md.
- ✅ **Slice 4.2.1 закрыт (2026-05-13)** — smart diff report на canonical:
  address compare выявил **format_diff 10487 (67.6%)** (FIAS vs raw form, та же
  locality) vs **real_diff 1354 + docling_only 1599 = 2953 кандидата** на
  re-geocode (-75% от raw 11841 different). 3366 param disagree-instances,
  **987 vision_normal_docling_exceed критично** для equipment-suggest, 846
  Vision-gall patterns. Shortlists: `shortlist-regeocode.jsonl` (2953) +
  `shortlist-reembed.jsonl` (2335). Artifact: `data/canonical/diff-report.md`.
- ⏳ **NEXT**: Slice 4.3 (re-geocode 2953 через Ahunter, ~384₽, 1-2 мин) →
  Slice 4.2.5 (re-embed 2335 через OpenAI text-embedding-3-large, ~$0.05) →
  Slice 3 (Prisma additive migration: новая `WaterAnalysisCanonical` table +
  `extraction_engine` + `intake_source` columns + `03b-extract-docling.ts`).

**Discoveries (важно):**
- **Vision-Haiku видит checkbox state** — `intakeType` точно извлечён в существующих 15504.
- Docling text-layer **не видит checkbox state** — для **новых** бланков `intakeType`
  деривируется алгоритмически из `depthMeters` + text-hints (`deriveIntakeType`).
  Для existing 15504 берём `visionPayload.intakeType` напрямую (sunk cost $220).
- `depthMeters` отсутствует в ~41% датасета — норма; `deriveIntakeType` падает
  в hint-match или в default `municipal` (опц. Vision-fallback на ~10% edge cases).
- Slovo `normalizeWaterParams` уже фиксит Vision Mg/Mn swap (70%) / sulfide-by-value (12%) / hardness-by-unit — compare делать на **derived**.
- Slovo `PARAM_SYNONYMS` имел gap: катионы только в unicode (`(Mg²⁺)`), нет ASCII pair → закрыто в Slice 1.
- Vision quality в существующих 15504 (per compare reports): ~20% customerName OCR-errors, ~30% address phone-склейка, 0.8% params disagree (Vision hallucination candidates) — **Docling даёт second-opinion для cleanup**.

---

## Ревью после каждого PR — правило рефлекса

После каждого успешного `git push` Claude **без напоминания** спавнит ревью-агентов параллельно (одним сообщением, `Agent` tool с `run_in_background: true`) на diff `origin/main..HEAD` (или диапазон последних коммитов этого PR):

1. **architect-reviewer** — ADR compliance, границы модулей, тех-выборы
2. **nestjs-code-reviewer** — TS/NestJS стиль, DTO, валидация, тесты
3. **prisma-pgvector-reviewer** — Prisma schema, миграции, индексы (**опускать если Prisma/БД не затронуты**)
4. **llm-integration-reviewer** — Anthropic SDK, prompts, caching (**опускать если libs/llm не затронут**)
5. **security-auditor** — секреты, PII, injection, IAM
6. **testing-specialist** — для пишущих задач: написать недостающие spec'и, добить покрытие модуля. На review — флагает критичные пробелы покрытия. Запускать когда есть новый код без тестов или явный запрос «напиши тесты на X».
7. **docs-reviewer** — согласованность документации с фактическим состоянием. Проверяет: ADR-статусы vs реализация, версии в `CLAUDE.md`/`overview.md` vs `docker-compose.infra.yml`/`package.json`, цифры между management/ файлами, roadmap дрейф, ссылки на несуществующие пути, ASCII-art и эмодзи в бизнес-доках. **Особо контролирует `CLAUDE.md`** — его читают все сессии и агенты, дрейф = отравленный контекст для всех. **Запускать обязательно** при изменениях в `docs/**/*.md` / ADR / README / `CLAUDE.md` / `package.json` / `docker-compose.infra.yml` / **`experiments/*/README.md`** (onboarding-доки lab-пайплайнов — orphan'ятся первыми при смене масштаба или модели), перед демо/handoff руководству, при закрытии фазы фичи. **Опускать** только если diff чисто кодовый и не затрагивает фазы/статусы фич (даже если сам doc не правлен).

> ⚠️ Reviewers 1-7 выше — кастомные, написаны вручную, местами слабее. Для большинства задач **предпочитай свежие wshobson-агенты ниже**, кастомные оставляй для slovo-специфики которой нет в generic (Prisma + pgvector нюансы, ADR-структура, slovo CLAUDE.md дрейф).

### wshobson generics (новая линия, рекомендованная для большинства задач)

Дополнительно в `.claude/agents/` лежат 8 свежих агентов из [wshobson/agents](https://github.com/wshobson/agents):

| Агент | Когда использовать | Заменяет / дополняет кастомного |
|---|---|---|
| **backend-architect** | Архитектура NestJS модулей, границы доменов, паттерны интеграции | дополняет `architect-reviewer` |
| **code-reviewer** | Универсальный ревью кода | заменяет `nestjs-code-reviewer` для не-slovo-специфики |
| **architect-review** | Архитектурные решения, паттерны, technical debt | альтернатива `architect-reviewer` |
| **test-automator** | Генерация unit/e2e тестов, покрытие | заменяет `testing-specialist` для generic-задач |
| **database-optimizer** | Slow queries, индексы, TypeORM/Prisma queries | дополняет `prisma-pgvector-reviewer` (он остаётся для pgvector-нюансов) |
| **performance-engineer** | Backend perf — N+1, caching, async | новая роль |
| **ai-engineer** | LLM-application архитектура: RAG pipelines, embedding strategies, prompt orchestration | дополняет `llm-integration-reviewer` |
| **prompt-engineer** | Дизайн и tuning prompts, few-shot, chain-of-thought, structured output | новая роль для Flowise / Vision-Catalog / Water-Analysis промптов |

`security-auditor` — оставлен кастомный (по конфликту имён wshobson'овский не скачивали; см. `C:\Users\Diamond\Desktop\multi-agent-setup\multi-agent-setup.md`).

По мере завершения агенты отдают находки — Claude сводит в сводный отчёт (🔴 / 🟡 / 🟢 / ✅ / следующие шаги) и предлагает порядок исправлений.

**Чего НЕ делаем:**

- ❌ Hook'и на `PostToolUse` для `git push` — ревью-агенты сами запускают Bash для `git diff`, получается рекурсия. Отвергнуто 2026-04-23 в обсуждении.
- ❌ Ждать когда разработчик скажет `/review`. Это рефлекс Claude, не ручной триггер.
- ❌ Спавнить все 7 агентов на тривиальном коммите (typo, docs, config bump) — 1-2 релевантных достаточно. Решение по размеру diff.

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

Если Claude Code запущен впервые в этом проекте:

1. Установить зависимости (`npm install`)
2. Поднять инфру (`npm run infra:up` + `npm run tools:up`)
3. Применить миграции (`npm run prisma:migrate:dev`) и сгенерировать клиент/DTO (`npm run prisma:generate`)
4. Проверить что API стартует (`npm run start:dev` → http://localhost:3101/health) и worker (`npm run start:worker:dev` для catalog-refresh cron)
5. **Ознакомиться с реализованными фичами:**
   - `vision-catalog-search` (Phase 1+2 ✅ закрыты) — `docs/features/vision-catalog-search.md`, executive summary в `docs/management/vision-catalog-executive-summary.md`
   - `knowledge-base` Phase 1 text-MVP ✅ — `apps/api/src/modules/knowledge/`, Phase 2+ отложен (ADR-006 амендмент 2026-05-02)
6. **Следующий шаг по roadmap** — vision-catalog Phase 3 (water-analysis, поверх инфры catalog: переиспользует Vision-pipeline + augmenter), либо webhook-trigger /catalog/sync-now, либо knowledge-base Phase 2 при появлении потребителя video/PDF-источников.

Перед реализацией новой фичи — всегда создавать `docs/features/<feature>.md` с планом (по образцу `docs/features/vision-catalog-search.md` или `docs/features/knowledge-base.md`).

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
