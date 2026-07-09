# ADR-011: Agentic core — runner + model orchestration

## Статус

🟡 **Draft — pending vertical slice proof point** (2026-06-19).

Гейт: одна реальная цель проходит цель→план→1 MCP-tool под permission→evidence→snapshot end-to-end через `libs/llm` к open-модели (`qwen/qwen3` через OpenRouter) с frontier fallback на Anthropic Haiku 4-5; permission корректно suspend'ит ран (snapshot + RMQ ack, см. § Eval-гейт п.2-3 в feature-spec — A3) и resume по respond; при фейле провайдера — quarantine + failover; A/B измерение open vs frontier в одинаковом harness (A4 в feature-spec); всё видно в SSE-стриме и в Langfuse. После gate → ✅ Принято или peer-retire ADR-010-style по evidence.

## Контекст

slovo развивает фичи поверх **chat-style RAG** (vision-catalog / catalog-ai-consultant / smart-search) — короткие request→response через Flowise chatflow. Каждый запрос — изолированный, без state-машины, без human-in-the-loop, без long-running планов. Для production AI consultant'а этого хватает.

Параллельно — Yandex ML Challenge 2026 (см. `docs/handoff/2026-05-29-ml-cup-c-batch.md`) и разбор production agentic-runner паттернов — показали что **следующий уровень** AI features требует **agentic loop**: модель ведёт задачу до результата, не ждёт промпта.

### Целевой образец — production agentic-runner (индустриальный паттерн)

Референсный production agentic-runner использует следующий pattern:

- **session-based runner** с `runId` / `resumedRunId`, длинные раны (минуты-часы);
- **SSE event-stream** через `GET /sessions/{id}/chat/answer` (или эквивалент) — клиент видит plan / tool_call / evidence / permission_request в реальном времени;
- **human-in-the-loop**: `POST /permissions/{id}/respond` блокирует runner пока пользователь не approve / reject действие;
- **multi-provider orchestration**: anthropic / openai / openrouter / xai + локальные через Ollama; **tiers** (frontier vs verified vs experimental); auto-quarantine падающих моделей (`quarantined_at` + `reason` + `failCount`); retry / failover;
- **budget cap** на ран (не на месяц — на конкретный goal);
- **snapshots + resume** при фейле или explicit user pause;
- **session-error-recovery** (chaos-test) — runner переживает kill -9 / network drop / model timeout.

Это **не копия**. Мы строим **наш runner** в нашем стеке, под наш ownership, на нашу архитектуру.

### Что у нас уже есть (reuse)

| Компонент | Расположение | Что даёт |
|---|---|---|
| RabbitMQ infra | ADR-003, `apps/worker/src/main.ts` | Persistent queue, exchange/binding, переживает worker restart |
| Worker NestJS monolith | `apps/worker/` | ScheduleModule + module per domain (см. CatalogRefreshModule) |
| API NestJS monolith | `apps/api/src/modules/` | budget / catalog / knowledge / water-analysis — flat structure |
| MCP tool catalog | `apps/mcp-flowise/src/tools/` | 66 typed tools mirror Flowise REST, с retry/error/типизацией |
| Prisma multi-file | `prisma/schema/*.prisma` | health / knowledge-base / water-analysis — domain-per-file (см. CLAUDE.md правило) |
| Langfuse config | `libs/common/src/config/env.schema.ts` | env-ключи готовы, v3 self-hosted stack в `docker-compose.langfuse.yml` |
| **Anthropic credential** | Flowise credential `d5e595c0-...` + ADR-004 (Claude как primary LLM) | Через тот же тинипрокси, native tool_calls structured, proven во всех slovo фичах (vision-catalog / catalog-ai-consultant / water-analysis). Используем как frontier baseline / fallback. |
| **Poolside chatflows + credential** | `experiments/poolside-smoke/` + Flowise credential `5d2eba13-...` + chatflows `poolside-smoke-v1` / `catalog-qa-poolside-v1` | Опц. отладочный convenience (proven proxy chain). **НЕ** часть открытой стороны (laguna-m.1 — закрытая хостед-модель). |
| Common observability | `libs/common/src/` | logger, http, ip-throttler, dev-only-header-auth |
| Budget capping pattern | `apps/api/src/modules/budget/` | budget service + cap + alert (uses в vision-catalog Phase 2) |

### Что у нас отсутствует (надо строить)

| Компонент | Почему нужен |
|---|---|
| `libs/llm` adapters | Сейчас stub (2 файла, пустой модуль). Нужен ILLMProvider контракт + OpenRouter (OpenAI-compatible для open) + Anthropic (native API для frontier) adapters + tier/health/quarantine state |
| `libs/agentic` loop-оркестратор | Goal→plan→action→evidence→snapshot state machine. Не существует |
| `prisma/schema/agentic.prisma` | AgentSession/AgentRun/RunEvent/RunSnapshot/Permission/ModelHealth tables |
| `apps/worker/src/modules/agentic-runner/` | RMQ consumer, держит loop, переживает restart, читает/пишет в RunEvent + RunSnapshot |
| `apps/api/src/modules/agentic/` | POST /runs (start), GET /runs/:id/stream (SSE), POST /permissions/:pid/respond, abort/resume |

## Решение

Строим **agentic core** в нашем монорепо как **отдельный модуль рядом** с существующими RAG-фичами. **НЕ переписываем** существующие chat flows. Slice — vertical, не horizontal.

### Архитектурные границы

1. **Runner живёт в `apps/worker`** (не в `apps/api`, не в edge функциях).
   - Длинные раны (минуты-часы) → edge времени не хватит.
   - Persistent через RabbitMQ → переживает restart.
   - Worker уже scaffolded под NestJS modules (`CatalogRefreshModule` как референс layout).

2. **API/SSE/permissions в `apps/api`** (отдельный module `agentic/`).
   - REST endpoints + SSE stream (через `@nestjs/platform-express` SSE support).
   - Communicates с worker через RMQ + Postgres (RunEvent — append-only event log).

3. **Reuse существующих abstractions**:
   - `libs/llm` — расширяем (контракт + adapters), не дублируем в `libs/agentic`.
   - `apps/mcp-flowise/tools` — agentic runner вызывает tools из этого каталога. Tool grants выдаются на ран.
   - Langfuse — autoreporter из runner; каждый LLM-вызов → Langfuse generation.
   - RabbitMQ — очередь `agentic.runs`; payload = `{ runId, parentRunId?, resumedFromRunId? }`.
   - Budget cap — берём pattern из `apps/api/src/modules/budget/`, обогащаем `budgetSpent` per run.

4. **New code только там, где требуется новая capability**:
   - `libs/agentic` — loop oркестратор + snapshot strategy + permission-гейт.
   - `prisma/schema/agentic.prisma` — schema для AgentSession / AgentRun / RunEvent / RunSnapshot / Permission / ModelHealth.

### Boundary первого среза (что MVP, что НЕ MVP)

| В MVP slice | НЕ в MVP slice |
|---|---|
| Один tool под permission-гейтом (выбирает feature-spec) | Несколько tools параллельно |
| Один MCP server как источник tools (`apps/mcp-flowise`) | Cross-server tool federation |
| Один permission-гейт на ран (sync блокировка до respond) | Multiple concurrent permissions per run |
| **Access-слой к open-моделям — OpenRouter** (унифицированный gateway, OpenAI-compatible). Primary open: **`qwen/qwen3`** (large, через OpenRouter). Alternate open: **`moonshotai/kimi-k2`** (через OpenRouter, для A/B в eval). | Прямые SDK к каждому open-провайдеру |
| **Frontier baseline / fallback — Anthropic `claude-haiku-4-5`** (native API через тинипрокси, ADR-004) при quarantine OpenRouter | Cross-provider load balancing на runtime |
| **Без локальных моделей** для MVP — всё cloud через тинипрокси (demo не требует локальной GPU, deploy clean) | Ollama / vLLM локально на runner машине |
| **Poolside laguna-m.1** — опц. отладочный convenience (credential уже в Flowise), **НЕ доказательство «open > frontier»** (laguna-m.1 — закрытая хостед-модель) | Использовать Poolside как часть открытой стороны |
| Quarantine state в БД (ModelHealth) | Auto-recovery quarantine (cooldown timer) |
| Snapshot на каждый событие RunEvent (atomic) | Differential snapshots / compression |
| SSE один-в-один с RunEvent log | WebSocket bidirectional control |
| Sub-agents — НЕТ | Sub-agents через child run pattern (резерв на ADR-012) |
| Edge functions — НЕТ | Edge functions (рассмотрим если/когда понадобится short-lived runner для embeds) |
| Cross-region failover — НЕТ | Multi-region |

Эти границы — **намеренно узкие**. Расширения каждой ветки — отдельные ADR (-012 sub-agents / -013 multi-provider failover / -014 edge runner).

### Тех. решения

- **RunEvent — append-only event sourcing**. State машины не лежит в `AgentRun.status` отдельно — выводится reduce'ом по RunEvent[]. Это даёт debug, replay, audit. Snapshot — компактный slice для resume.
- **SSE через Postgres LISTEN/NOTIFY + resilient resume (A7)**. Worker пишет RunEvent + `NOTIFY run.<id>`; API подписан, форвардит event клиенту. Альтернативой был Redis pub/sub — не нужен extra dependency, Postgres уже есть. **NOTIFY используется только для SSE push в браузер**, не для координации worker resume (см. ниже). **Resilience для РФ/DPI:** сервер читает стандартный `Last-Event-ID` header при reconnect (нативный SSE pattern) → catch-up `SELECT RunEvent WHERE seq > $lastSeenSeq` → нулевая потеря событий при обрывах коннекта или restart'ах API процесса. **Heartbeat** SSE comment-line `: ping\n\n` каждые 15 секунд при idle — держит коннект против прокси/DPI/CloudFlare timeout'ов (стандартные 30-60s). EventSource в браузере авто-реконнектит сам. Детали — feature-spec § Endpoints SSE.
- **Permission gate — suspend/resume через RMQ (A3)**. Worker НЕ держит RMQ-message неacked'нутым на 24h (дефолт `consumer_timeout` ≈ 30 мин закрыл бы канал). Вместо этого на permission_request: атомарно INSERT Permission + RunEvent + UPSERT RunSnapshot, UPDATE AgentRun.status=`awaiting_permission`, `ack` RMQ-message, return из consumer handler. На respond (`POST /permissions/:id/respond`) API publish'ит resume-message в `agentic.runs`, любой свободный worker подхватит и восстановит state из snapshot. Worker'ы взаимозаменяемы, persistence через БД не через RMQ-state. Детали — feature-spec § Permission gate state machine.
- **Snapshot strategy + tool dedup-by-event (A5)**. JSONB в `RunSnapshot.state` — runtime state runner'а (currentPlan, tool execution context, accumulatedEvidence). `seq` increment, atomic на BD-side (через `RETURNING`). **Hard resume идемпотентность для mutating tools НЕ полагается на «name-uniqueness»** (Flowise не гарантирует это — повторный create с тем же storeName создаст второй DS). Pattern: (1) args (incl. timestamps/UUIDs/generated names) pin'ятся в `RunSnapshot.state.nextToolCall.args` atomically с `tool_call` RunEvent ДО invoke; на resume args берутся из snapshot, не регенерятся replan'ом. (2) Перед каждым tool invoke runner SELECT'ит RunEvent WHERE type='tool_result' AND payload.toolCallSeq=$current → если найден → skip exec, используем cached output. (3) Для MVP цели — pre-invoke probe (list resources by name → reuse если найден) поверх MCP. Pattern общий, не только для `flowise_docstore_create`. Детали — feature-spec § Permission gate / Hard resume.
- **ModelHealth state**. Mini state machine: `verified` → `degraded` (>3 fails в окне) → `quarantined` (cooldown 24h). Reset по успешному probe. Per-provider per-model row.
- **Error classification — transient vs persistent (A6, критично для РФ/DPI)**. Adapter в `libs/llm` классифицирует ошибки до инкремента `ModelHealth.failCount`. `transient` (TLS-reset / `ECONNRESET` / `502` / `503` / `504` / `408` / `429 c Retry-After` / proxy errors / partial stream) → retry того же провайдера с exp backoff 1s/2s/4s+jitter (max 3 попытки), `failCount` НЕ изменяется. `persistent` (`401` / `403` / `404 model not found` / consistent `500` / quota exhausted) → инкремент `failCount` → state machine → quarantine + failover. Без классификации каждый DPI-резет спуриозно карантинит хорошую open-модель и жжёт лишние $ на frontier. **Partial stream guard:** event `model_call` / `tool_call` пишется в RunEvent **только на полном завершении** (получен `[DONE]` маркер / Anthropic `message_stop`); incomplete stream discarded → clean retry с last snapshot. Детали — feature-spec § Provider tier / health state machine, § Классификация ошибок.

## Альтернативы

### Build everything in apps/api (без worker)

❌ Длинные раны (минуты) под HTTP timeout не идут. Нужен отдельный процесс — worker уже scaffolded и используется в catalog-refresh.

### Внешний agentic framework (LangGraph / CrewAI)

❌ Vendor lock на abstractions которые не контролируем. У нас уже есть `apps/mcp-flowise` каталог tools — он наша абстракция, и agentic loop поверх MCP — простое решение.

### Edge functions (Supabase / Vercel)

❌ Time limit 60-300s — недостаточно для real agentic runs (таргет — часы).

### Snapshot через Redis вместо Postgres

❌ Atomic не гарантирован, нужна транзакция с RunEvent. Postgres уже main store, не вносим dependency.

### Polling вместо LISTEN/NOTIFY

❌ Latency (1-5s) для SSE → плохой UX. LISTEN/NOTIFY даёт <100ms.

## Reuse-карта

```
┌─────────────────────────────────────────────────────────┐
│                  agentic core slice                      │
│                                                          │
│  apps/api/src/modules/agentic/  (REST + SSE)            │
│  apps/worker/src/modules/agentic-runner/  (loop держит)  │
│  libs/agentic/  (loop logic, snapshot, permission gate) │
│  prisma/schema/agentic.prisma  (6 tables)               │
│                                                          │
└───────────────┬─────────────────────────────────────────┘
                │ reuse ↓
                │
┌───────────────┴─────────────────────────────────────────┐
│  RabbitMQ (ADR-003)   → очередь agentic.runs            │
│  libs/llm             → расширяем: ILLMProvider+adapters│
│  apps/mcp-flowise     → tools для runner                │
│  Langfuse             → telemetry generations           │
│  apps/api/budget      → паттерн budget-cap → budgetSpent│
│  libs/common          → logger, config, http            │
│  prisma multi-file    → domain-per-file convention      │
└─────────────────────────────────────────────────────────┘
```

## Последствия

### Позитивные

- **Vertical slice** проверяет всю архитектуру end-to-end до commitment в широкие фичи.
- **Reuse-карта** минимизирует drift с существующим монолитом.
- **Append-only event log** даёт debug + audit + replay для будущих сложных runs.
- **Boundary границы** оставляют пространство для следующих ADR (sub-agents, multi-provider) без рефакторинга MVP.

### Риски

- **Postgres LISTEN/NOTIFY** имеет лимит ~8000 listeners на connection — при scale нужен fan-out (отдельный shared listener в API процессе).
- **Snapshot JSONB** может разрастаться — нужна стратегия GC старых snapshots (cron).
- **Permission timeout** — если человек не отвечает, ран висит. MVP: hard timeout 24h → `permission_timeout` event → ран в state `aborted_by_timeout`. Можно адаптивно расширить в следующих slice.
- **libs/llm с stub** — придётся написать с нуля. Боундари среза честная — два cloud provider'а (OpenRouter access-слой для open + Anthropic native для frontier).
- **`apps/mcp-flowise` tools** написаны для Flowise REST. Они могут не идеально matching под agentic loop semantics. Slice выберет один tool и подгонит interface.

### Operational

- Новая queue в RMQ → нужен `agentic.runs` exchange + DLQ.
- Новая Postgres database changes → forward-only migration (CLAUDE.md правило, ADR-005).
- Langfuse `release` тег для agentic generations → новый namespace для фильтрации.

## Eval-гейт для MVP slice

Slice проходит когда **все условия одновременно**:

1. **End-to-end ран** на одной реальной цели (TBD в feature-spec) с одним MCP-tool под permission-гейтом доходит до `done` event с evidence.
2. **Permission suspends ран корректно (A3)**: на permission_request ран в state `awaiting_permission`, RunSnapshot создан, RMQ-сообщение `ack`'нуто (проверка через RabbitMQ management UI — `messages_unacknowledged` не растёт). Worker consumer свободен для других ранов.
3. **Resume работает по обоим путям**: soft resume (POST respond approved → RMQ resume-message → worker подхватил → loop продолжается; latency <2s до первого нового RunEvent) И hard resume с **A5 dedup-by-event** (`kill -9` worker в state `executing` mid-tool → RMQ redelivery → новый worker восстановил state из RunSnapshot c pinned args → SELECT tool_result WHERE toolCallSeq=$current для дедупа → pre-invoke probe → loop продолжается до `done`; assertion `flowise_docstore_list count == 1` — не дубль). Подробности — feature-spec § Permission gate / Hard resume + § Eval-гейт п.3.
4. **Quarantine + failover с разделением transient vs persistent (A6, критично для РФ/DPI)**: (4a) 3 подряд `ECONNRESET`/`502`/`504` на запрос к `qwen/qwen3` через тинипрокси → adapter retry'ит того же провайдера 3× с exp backoff, ModelHealth `failCount` НЕ изменяется, model остаётся `verified` (transient не квантинит); (4b) persistent фейл (`401` отозван key / `404` deprecated model) → quarantine → failover на alternate (`moonshotai/kimi-k2`) или frontier (`claude-haiku-4-5`); (4c) partial stream (TCP RST mid-response) → один `model_call` event на retry-успех, не два. Детали — feature-spec § Eval-гейт п.4 sub-assertions.
5. **SSE стрим — latency + resilience (A7)**: события plan / tool_call / permission_request / evidence / done доставляются в реальном времени, latency event-to-stream <500ms; на reconnect клиент шлёт `Last-Event-ID`, сервер catch-up missing events (нулевая потеря при `docker restart` API); heartbeat `: ping` каждые 15s держит idle-коннект против прокси/DPI timeout'ов. Детали — feature-spec § Eval-гейт п.5.
6. **Langfuse** регистрирует все LLM вызовы агентного loop'а; totalCost = AgentRun.budgetSpentUsd (±2%).
7. **Tests**: loop logic + quarantine state machine + permission gate state machine — unit, в slovo CLAUDE.md правиле «новый код по умолчанию покрывается тестами»; coverage ≥80% для `libs/agentic`.
8. **Open vs Frontier A/B на одной цели (A4)**: та же цель прогнана трижды (Qwen3 / Kimi K2 / Haiku) в одинаковом harness, результат — Markdown-таблица `quality + cost per run` в `experiments/agentic-core/eval-open-vs-frontier-<date>.md`. Тезис «open + harness догоняет frontier при ~1/10 cost» либо подтверждён данными, либо опровергнут — оба исхода валидны (опровержение фиксируется в выводах, не блокирует slice). Детали — feature-spec § Eval-гейт п.8.

Если 1-3 пункта fail → fix в рамках slice (не retire). Если >3 fail или нашли архитектурный gap (suspend/resume race condition при RMQ redelivery; LISTEN/NOTIFY не масштабируется как ожидали), который требует rebuild → retired как ADR-010, открываем новый ADR с уроками. Если п. 8 показывает «open пока не дотягивает» — slice **не retire**'ится (архитектура работает), тезис пересматривается измеренно, не декларируется.

## Open questions

1. **Какая цель для MVP slice?** Должна быть реальная (не toy), но узкая (один tool достаточен). Кандидаты:
   - «Покажи cost overrun в Langfuse за последние 7 дней» — tool = MCP Langfuse query, permission = чтение БД (низкий риск).
   - «Создай новый Document Store с N чанков» — tool = `mcp__flowise_docstore_create`, permission = mutate Flowise (выше риск, лучше для гейта).
   - Решим в feature-spec.

2. ~~Provider stack~~ → **Решено (A1)**: access-слой к open-моделям через **OpenRouter** (OpenAI-compatible gateway). Open primary — `qwen/qwen3` (large). Alternate open — `moonshotai/kimi-k2`. Frontier baseline / fallback — Anthropic `claude-haiku-4-5` (native API через тинипрокси, ADR-004). Poolside — опц. отладочный convenience, не открытая сторона (laguna-m.1 закрытая). Без локальных моделей в MVP. Тезис «open > frontier» формулируется как **экономика** (open догоняет при ~1/10 cost), измеряется A/B в eval-гейте (см. § Eval-гейт п.8). См. feature-spec § Q2.

3. **SSE через express vs fastify**. NestJS supports оба. У нас в `apps/api` уже что-то стоит? — feature-spec проверит.

4. **AgentRun budgetSpent units**: USD или tokens? Budget pattern в `apps/api/budget/` — посмотреть как они трекают.

5. **DLQ policy**: failed run → DLQ для ручного review или auto-retry с backoff? MVP — DLQ, без auto-retry (proстая логика, observable).

## Связанные ADR

- ADR-003 (RabbitMQ) — основа для persistent run queue
- ADR-004 (Claude как primary LLM) — agentic runner dispatch'ит на Claude как frontier baseline/fallback (Haiku 4-5); open-сторона тезиса покрывается OpenRouter (Qwen3 + Kimi K2) — все три модели меряются A/B в eval-гейте
- ADR-005 (Prisma forward-only migrations) — agentic.prisma миграции по этому правилу
- ADR-008 (Flowise MCP) — наш каталог tools, который runner будет дергать
- ADR-010 (retired) — урок про evidence-based ретир: тот же подход применяем здесь

## Связанные docs

- `docs/features/agentic-core.md` — feature spec этого ADR (vertical slice scope, schema, endpoints, eval-гейт детали)
- `docs/features/llm-batch-data-preprocess.md` — pattern guide который мог бы быть basis для batch agentic feature в будущем
- `docs/handoff/2026-05-29-ml-cup-c-batch.md` — handoff с ML Cup C work (similar runner patterns)
