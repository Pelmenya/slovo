# @slovo/mcp-flowise

MCP-сервер для управления Flowise REST API из Claude Code (и любого другого MCP-клиента). Standalone-приложение в slovo monorepo (`apps/mcp-flowise/`), запускается отдельным stdio-процессом — не часть `apps/api`/`apps/worker` runtime'а.

## Зачем

Эксперимент vision-catalog (см. `docs/experiments/vision-catalog/`) показал что **всё управление Flowise покрыто REST API** (auth через `Authorization: Bearer <apiKey>`). Вместо ручного `curl --noproxy '*' -X POST -H "Authorization: ..." -d @payload.json ...` Claude Code получает набор typed-tools и работает с Flowise одной строкой:

> «Найди в catalog-aquaphor смесители для кухни» → Claude дёргает `flowise_docstore_query` → возвращает top-K docs.
> «Создай Document Store catalog-aquaphor-v2 с теми же loader'ом и embedding'ом, но HNSW индексом» → Claude дёргает несколько tools программно.

Полное обоснование выбора self-built vs community/официальный — в **`docs/architecture/decisions/008-flowise-mcp.md`**.

## Стек

- **Runtime**: Node.js ≥ 24.15 (как у slovo)
- **Язык**: TypeScript 6.x, strict mode, no-any, single-source `type` declarations с префиксом `T`
- **MCP SDK**: `@modelcontextprotocol/sdk` (official Anthropic)
- **Валидация**: `zod` v4 (уже в slovo deps)
- **HTTP**: встроенный `fetch` (Node.js 24+)
- **Тесты**: Jest (как остальной slovo — `*.spec.ts`)
- **Запуск dev**: `node --env-file=.env node_modules/tsx/dist/cli.mjs apps/mcp-flowise/src/index.ts` (без билда)

## Структура

```
apps/mcp-flowise/
├── package.json
├── README.md                      # эта дока
└── src/
    ├── index.ts                   # entry: runServer().catch(...)
    ├── server.ts                  # McpServer + StdioServerTransport + tools loop
    ├── config.ts                  # env validation (FLOWISE_API_URL + FLOWISE_API_KEY)
    ├── api/
    │   ├── client.ts              # FlowiseClient: fetch + bearer + retry на 429 + throttle
    │   ├── endpoints.ts           # константы REST путей
    │   └── t-flowise.ts           # типы (TDocumentStore, TCredential, TQueryResult, ...)
    ├── utils/
    │   └── errors.ts              # FlowiseError + formatErrorForMcp
    └── tools/
        ├── index.ts               # реестр tools (generic TToolDefinition<TIn, TOut>)
        ├── t-tool.ts              # типы TToolResult, TToolDefinition
        ├── ping.ts                # flowise_ping
        ├── credentials.ts         # flowise_credentials_list
        └── docstore.ts            # flowise_docstore_list + flowise_docstore_query
```

Соглашения (правила slovo):
- **Имена tools** — `flowise_<verb>_<resource>` (snake_case, как требует MCP SDK).
- **Типы** — префикс `T`, файлы чистых типов с префиксом `t-` (`feedback_type_conventions`).
- **4 пробела** во всех файлах.
- Никакого `any`, унифицированный `TToolResult<T> = { success, data, error }`.

## Env

Локальные `.env` slovo (см. `.env.example` секция Flowise):

| Var | Default | Описание |
|---|---|---|
| `FLOWISE_API_URL` | `http://127.0.0.1:3130` | URL Flowise (для slovo dev — port из `docker-compose.infra.yml`) |
| `FLOWISE_API_KEY` | — обязательно | Bearer token из Flowise UI → Credentials → API Keys. Если пуст — все RBAC-protected endpoint'ы упадут с 401 |

`FLOWISE_API_URL` уже валидируется в `libs/common/src/config/env.schema.ts` (для slovo runtime). `FLOWISE_API_KEY` — пока валидируется только в `apps/mcp-flowise/src/config.ts` через локальный zod-schema; добавление в общую `env.schema.ts` — в `tech-debt.md` пункт C5 (когда `apps/api`/`apps/worker` начнёт ходить в Flowise REST).

Получить ключ: в Flowise UI (http://127.0.0.1:3130) → левый sidebar → **API Keys** → **+ Create Key** → permissions `documentStores:*`, `chatflows:*`, `credentials:view` (минимум для нашего MVP).

## Запуск

### Локально для dev-проверки (smoke без Claude Code)

```bash
# из корня slovo — initialize + tools/list одной командой
{
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.1"}}}'
  echo '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  echo '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
} | node --env-file=.env node_modules/tsx/dist/cli.mjs apps/mcp-flowise/src/index.ts
```

Должен вернуть JSON-RPC ответ `protocolVersion: "2025-11-25"` и список из 4 tools.

### Через Claude Code

Project-level конфиг — `slovo/.mcp.json` (коммитится в репо, секретов внутри нет):

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

`node --env-file=.env` — нативный флаг Node 20.6+ — читает slovo `.env` при запуске MCP-сервера и проставляет env переменные процессу. Никакого dotenv-пакета и никакой `${VAR}` подстановки в `.mcp.json` (Claude Code такие не резолвит из `.env`, только из системного env).

После рестарта Claude Code в диалоге появятся tools `mcp__flowise-slovo__flowise_*`.

**Личный override** (если разработчик хочет переопределить env / путь под свою машину) — добавить блок `mcpServers.flowise-slovo` в `~/.claude.json` (user-level). Project-level `.mcp.json` имеет более низкий приоритет, перетирается user-level конфигом.

## Доступные tools (MVP)

| Tool | Описание | Пример вызова |
|---|---|---|
| `flowise_ping` | health-check Flowise (`GET /api/v1/ping`) | без параметров |
| `flowise_credentials_list` | список credentials с id и type | без параметров (для discovery credentialId), опциональный `credentialName` фильтр |
| `flowise_docstore_list` | список Document Stores | без параметров |
| `flowise_docstore_query` | retrieval-search в Document Store без LLM (`POST /api/v1/document-store/vectorstore/query`) | `{ storeId, query, topK? }` |

Расширение — по факту использования. См. `docs/architecture/tech-debt.md` секцию C для точного roadmap (PR6: prediction_run с uploads, docstore_upsert/refresh; Phase 2: chatflow_create/node_list).

## Reference — где что копать

- **Flowise REST endpoints**: `/usr/local/lib/node_modules/flowise/dist/routes/<feature>/index.js` внутри `slovo-flowise` контейнера. Через `docker exec slovo-flowise sh -c "cat ..."`. Правило `feedback_read_flowise_source` в memory.
- **Payload schemas**: `dist/services/<feature>/index.js` — там видно какие поля передавать в `loaderConfig`/`splitterConfig` и т.д.
- **MCP TypeScript SDK**: https://github.com/modelcontextprotocol/typescript-sdk (`McpServer`, `StdioServerTransport`, `registerTool`).
- **MCP Spec**: https://modelcontextprotocol.io/specification/2025-11-25 (latest).
- **Lab journal с reproducible recipe**: `docs/experiments/vision-catalog/2026-04-29-document-store-vector-pipeline.md` день 2 — там полный набор curl-команд которые этот MCP-сервер заменяет.
- **Референс архитектуры**: `C:\Users\Diamond\Desktop\mcp-moysklad` — наш предыдущий MCP-сервер на том же стеке. Tools registry, ToolResult shape, retry+throttle client — копируется паттерн 1:1.

## Тесты

```bash
# из корня slovo
npm test -- apps/mcp-flowise
```

Покрытие — Jest конфиг в root `package.json` подхватит `apps/mcp-flowise/**/*.spec.ts` автоматом. На MVP — 27 spec'ов (config, client, errors, 3 tools), все зелёные.

## Roadmap (по факту использования, не сразу всё)

См. `docs/architecture/tech-debt.md` секция **C. MCP-сервер Flowise**. Ключевые вехи:

- **MVP (текущее)** — `ping`, `credentials_list`, `docstore_list`, `docstore_query`. Закрывает Phase 0 vision-catalog.
- **PR6 vision-catalog Phase 1** — `prediction_run` с image uploads, `docstore_upsert` (заменяет 4-step flow), `docstore_refresh` (cron 4ч из ADR-007).
- **Phase 2** — `chatflow_list/get/create/update/delete` + `node_list/get` для программной генерации vision-флоу.
- **Production** — extract в отдельный репо `Pelmenya/mcp-flowise`, npm/Smithery publish — когда scope вырастет до 30+ tools.
