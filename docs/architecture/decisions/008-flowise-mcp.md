# ADR-008: MCP-сервер для Flowise — собственный TypeScript в monorepo

## Статус
✅ Принято — 2026-04-30 (после Phase 0 vision-catalog, реализация в `apps/mcp-flowise/` коммит `dfd14bf` + follow-up по итогам architect-review).

## Контекст

В Phase 0 vision-catalog (см. `docs/experiments/vision-catalog/2026-04-29-document-store-vector-pipeline.md`, день 2) выяснилось:

1. **Flowise полностью покрыт REST API** (правило `feedback_flowise_full_api_coverage` в memory). Все UI-действия мапятся 1:1 на endpoint'ы — Document Stores, Chatflows, Credentials, Variables, Custom Tools. Auth — `Authorization: Bearer <apiKey>`.
2. **Ручной curl-ритуал не масштабируется.** Закрытие Phase 0 потребовало 4-step flow (loader/save → process → vectorstore/save → vectorstore/insert) + дополнительные curl'ы для discovery credentials/storeId. На каждое действие — формирование payload, экранирование, `--noproxy '*'`, bearer-token. Для Phase 1 (`apps/worker/catalog-refresh`, автогенерация vision-флоу из Claude) этот overhead станет блокером DX.
3. **Официального MCP-сервера у Flowise нет.** В Flowise есть **MCP-client** (Custom MCP node в Chatflow palette для потребления внешних серверов), но не сервер для управления самим Flowise. Это design choice вендора — REST уже их product channel, дублировать в MCP они не хотят (см. lab journal анализ «Почему нет официального»).
4. **Community-варианты неполные:** проверены `matthewhand/mcp-flowise` (54⭐, Python, last push 2025-01 — устарел до Flowise 3.x), `wksbx/flowise-mcp-server` (TS, свежий — но **без Document Store coverage**), `MilesP46/FlowiseAI-MCP` (Python, claims full coverage — но 2⭐, solo, через `uvx` Python-runner — лишний стек). Ни один не подходит «из коробки».

## Решение

**Собственный MCP-сервер в `apps/mcp-flowise/` slovo monorepo.** TypeScript на нашем стеке, тонкая обёртка над Flowise REST.

### Стек

- **Runtime:** Node.js ≥ 24.15 (как у slovo)
- **MCP SDK:** `@modelcontextprotocol/sdk` (official Anthropic, не community-обёртка)
- **Валидация:** `zod` v4 (уже в slovo deps)
- **HTTP:** built-in `fetch` (Node 24+) — без HTTP-клиент-зависимостей
- **Запуск dev:** `node --env-file=.env node_modules/tsx/dist/cli.mjs apps/mcp-flowise/src/index.ts` (нативный Node 24 `--env-file` без dotenv-пакета)
- **Тесты:** Jest (как остальной slovo, `*.spec.ts` рядом с кодом)

### Архитектурный паттерн

Скопирован 1:1 с нашего `mcp-moysklad` (отдельный репо `Pelmenya/mcp-moysklad`, battle-tested):

- `src/api/client.ts` — `FlowiseClient` с bearer auth + retry на 429 + throttle + timeout. Lazy singleton с `resetForTests()`.
- `src/tools/<resource>.ts` — zod schema + handler, унифицированный generic `TToolDefinition<TIn, TOut>` и `TToolResult<T>` shape.
- `src/server.ts` — `McpServer` + `StdioServerTransport` + registry loop с runtime-валидацией через `schema.parse(args)` перед вызовом handler.
- `src/utils/errors.ts` — `FlowiseError` с `statusCode` + `formatErrorForMcp` для унифицированного маппинга в MCP `content`/`isError`.

### Подключение к Claude Code

Через `slovo/.mcp.json` (project-level, коммитится в репо без секретов):

```json
{
    "mcpServers": {
        "flowise-slovo": {
            "command": "node",
            "args": [
                "--env-file=.env",
                "node_modules/tsx/dist/cli.mjs",
                "apps/mcp-flowise/src/index.ts"
            ]
        }
    }
}
```

`--env-file=.env` подхватывает `FLOWISE_API_KEY` из локального `.env` slovo. Никаких `${VAR}`-подстановок Claude Code не резолвит из `.env` (только из системного env), поэтому идём через нативный Node-флаг.

## Альтернативы

### A. Использовать `MilesP46/FlowiseAI-MCP` (community)

**Плюсы:**
- Готов сразу — 46 tools, claims full API coverage включая Document Store.
- Установка через `uvx --from git+https://...` за минуту.

**Минусы:**
- Solo-maintainer (2 stars, 8 месяцев без обновлений на момент решения).
- Python в системе разработчика — лишний стек на Windows-машине пользователя.
- Не контролируется нами — при breaking change в Flowise REST правка ждёт upstream.
- Нельзя интегрировать с slovo `apps/worker` напрямую (Python ≠ TypeScript).

**Отклонена:** для DX-инструмента долгосрочной важности контроль > 2-минутная установка.

### B. Форк `MilesP46/FlowiseAI-MCP` под slovo

**Плюсы:** базовый scope готов, можно адаптировать.

**Минусы:** Python (всё равно), maintenance форка, drift с upstream.

**Отклонена:** при отказе от Python — равнозначно «писать с нуля», а с Python — те же проблемы что в А.

### C. Собственный TypeScript MCP в **отдельном** репо `Pelmenya/mcp-flowise`

**Плюсы:**
- Чисто публикуется в npm/Smithery позже, может быть полезен другим проектам.
- Не размывает scope slovo monorepo.

**Минусы:**
- Дублирование инфры (eslint/prettier/CI/Husky).
- Schema-drift: при изменении Flowise REST между версиями приходится отдельно обновлять mcp-flowise репо и slovo код, который его использует. В monorepo обновляется одним PR.
- Отвлекает от core задач slovo на стадии MVP.

**Отклонена пока, рассмотрена позже:** см. секцию «Когда пересмотреть».

## Последствия

### Положительные

- **DX-буст** на работу с Flowise через Claude Code (typed tools вместо curl-ритуалов). Подтверждено smoke-тестом: time-to-result < 30 сек на запрос вместо 2-3 минут на формирование curl.
- **Reusable для slovo runtime.** `apps/worker/catalog-refresh` (PR6) и `apps/api/catalog/search/*` могут импортировать те же handler'ы через `@slovo/mcp-flowise/api/client` — получают типизированный Flowise client из коробки.
- **Один источник истины** для Flowise REST schemas в slovo. Изменения REST API между версиями Flowise — один файл правки в `apps/mcp-flowise/src/api/`.
- **Прозрачность.** Все вызовы — простой `fetch` с bearer, никакой скрытой логики community-обёрток.

### Отрицательные

- **Maintenance load.** При апгрейде Flowise (3.1 → 3.2) нужно проверять REST-совместимость (~1 час раз в месяц). Mitigated CI smoke-тестами против реального dev-инстанса (см. tech-debt).
- **На старте не покрывал 100% Flowise REST.** В MVP-коммите (`dfd14bf`) было 4 tools. Расширили до 54 в коммите `ba3b555`, далее до 66 (см. amendment ниже).

## 2026-04-30 — амендмент: scope расширен до 66 tools, цель — npm/Smithery publish

В коммите `ba3b555` пересмотрен scope: **полное зеркало Flowise REST API** (стартово 54 tools, далее расширено до **66** — Document Stores 22, Chatflows 6, Nodes discovery 2, Predictions 1, Vector 1, Credentials 5, Variables 4, Custom Tools 5, Assistants 5, Composite helpers 3, DX helpers 3, Misc 4 — chatmessage_list/abort/delete_all, upsert_history_list/patch_delete, ping, attachments_create). Решение мотивировано:

1. **REST-обёртка — копипаст по schema, не "speculative architecture".** Все 66 endpoint'ов реальны, payload-формы взяты из исходника Flowise (`dist/services/<feature>/`). Стоимость удаления неиспользуемого позже = `git rm`. Стоимость написать на месте = +30 LOC × N контекст-переключений.
2. **Phase 1 (PR6) и Phase 2 (chatflow autogen) используют разные subsets.** PR6: `prediction_run` (uploads), `docstore_upsert`, `docstore_refresh`. Phase 2: `chatflow_create`, `chatflow_update`, `nodes_list`, `nodes_get`. Делать по требованию = три захода по 1-2 вечера каждый, против один заход.
3. **Готовность к extract в `Pelmenya/mcp-flowise` + публикацию в npm/Smithery** — теперь это реальная цель, не «когда-нибудь».

**Текущее состояние (после `ba3b555` + follow-up'ов до 2026-05-02):**

- `apps/mcp-flowise/` — изолированный package: own `package.json` (publish-ready: `description`, `keywords`, `bin`, `main: dist/index.js`, `repository`, `homepage`, `license: MIT`, `prepublishOnly`), `tsconfig.build.json` (declarations + source maps + outDir `dist/`), `LICENSE` (MIT, Copyright 2026 Dmitry Lyapin).
- **66 tools** в стиле `mcp-moysklad`: zod schema + handler + унифицированный `TToolResult<T>`. Все типы `T<Resource><Action>{Input,Data}` экспортируются — consumers могут импортировать строго.
- TypeScript clean (`npx tsc --noEmit` + `npm run build` в `apps/mcp-flowise/`), ESLint clean. Live smoke через MCP подтвердил все 66 tools на slovo Flowise dev-инстансе.

**План extract в три пакета — `Pelmenya/flowise-client` (foundation) + `Pelmenya/mcp-flowise` (transport) + `Pelmenya/flowise-flowdata` (chatflow domain):**

После создания `libs/flowise-client/` (commit `52ef613`, PR6 prerequisite) реальная архитектура — три уровня:
- **`flowise-client`** — REST-клиент (fetch + bearer + retry). Используется и mcp-flowise, и slovo runtime (apps/worker, apps/api).
- **`mcp-flowise`** — MCP transport-обёртка над flowise-client (66 tools).
- **`flowise-flowdata`** — typed builder для chatflow flowData JSON.

Extract — поэтапный, в правильном порядке dependencies:

**Шаг 0 — `flowise-client` (foundation, переезжает первым):**

1. `git filter-repo --path libs/flowise-client/ --path-rename libs/flowise-client/:`.
2. Переименовать `@slovo/flowise-client` → `@pelmenya/flowise-client`.
3. Добавить **build-step** в `tsconfig.lib.json` или новый `tsconfig.build.json`:
   - `outDir: dist/`, `declaration: true`, `declarationMap: true`, `sourceMap: true`.
   - `package.json`: `main: dist/index.js`, `types: dist/index.d.ts`, `files: [dist, README, LICENSE]`, `prepublishOnly: tsc + tests`.
4. Перенести `zod` в локальный deps (используется в `t-config.ts`? — нет, только в apps. lib работает без zod).
5. `npm publish --access public`.

**Шаг 1 — `flowise-flowdata` (domain):**

1. `git filter-repo --path libs/flowise-flowdata/ --path-rename libs/flowise-flowdata/:`.
2. Переименовать `@slovo/flowise-flowdata` → `@pelmenya/flowise-flowdata`.
3. `dependencies: { "@pelmenya/flowise-client": "^0.1.0" }` (peer от flowise-client для типов).
4. Build-step как в Шаге 0.
5. `npm publish --access public`.

**Шаг 2 — `mcp-flowise` (transport):**

1. `git filter-repo --path apps/mcp-flowise/ --path-rename apps/mcp-flowise/:`.
2. Переименовать `@slovo/mcp-flowise` → `@pelmenya/mcp-flowise`.
3. `dependencies: { "@modelcontextprotocol/sdk": ..., "zod": ..., "@pelmenya/flowise-client": "^0.1.0" }`.
4. Заменить путь `../../node_modules/tsx` в `scripts.dev` на локальный `tsx` (devDep).
5. **`peerDependencies`** на `@pelmenya/flowise-flowdata` если bundler-сервер хочет давать advice flowdata builder (опционально).
6. `npm publish --access public` или Smithery submit.

**Для каждого пакета** — `.github/workflows/{test,publish}.yml` (CI test+lint, publish on tag).

Direction зависимостей строго однонаправленный (Шаг 0 → Шаг 1 → Шаг 2), аналогично паре `@nestjs/microservices` → `@nestjs/common`. Никаких циклов между пакетами.

**Триггер extract** — любой из:
- Появится 2-й внешний потребитель (другой проект Дмитрия / community ask на GitHub Issues).
- Stabilization period (2 месяца без breaking changes в API tools).
- Smithery официально откроется для submission и появится экосистема.

До тех пор живёт в slovo monorepo — один Husky/ESLint, синхронные обновления вместе с `apps/api` и `apps/worker` (которые тоже могут импортировать через `@slovo/mcp-flowise/api/client`).

## Когда пересмотреть

- **Если Flowise выпустит официальный MCP-сервер** — заменить наш на него, оставив только slovo-specific обёртки.
- **Если появится проблема перфоманса** — переход на native Rust/Go MCP server (вряд ли нужно, stdio-overhead нулевой).
- **Когда сработает один из триггеров extract выше** — провести extract по плану, опубликовать в npm и Smithery.

## Связанные ADR

- **ADR-001** (Modular Monolith) — `apps/mcp-flowise/` это standalone executable в monorepo, не nest-app, но вписывается в архитектуру (apps/* = исполняемые артефакты).
- **ADR-006** (Knowledge Base) и **ADR-007** (Catalog ingest) — оба полагаются на Flowise как LLM runtime; MCP-сервер ускоряет работу с этим runtime во время разработки.
- **`feedback_flowise_full_api_coverage`** в memory — основание для решения «всё через REST».
- **`feedback_minimal_deps_proven`** в memory — обоснование выбора `@modelcontextprotocol/sdk` (official) + thin wrapper, а не community-обёрток.
