# @slovo/mcp-flowise

MCP-сервер для управления Flowise REST API из Claude Code (и любого другого MCP-клиента). Inproject-либа в slovo monorepo. Запускается отдельным stdio-процессом, не часть `apps/api`/`apps/worker` runtime'а.

## Зачем

Сегодняшний эксперимент vision-catalog (см. `docs/experiments/vision-catalog/`) показал что **всё управление Flowise покрыто REST API** (auth через `Authorization: Bearer <apiKey>`). Вместо ручного `curl --noproxy '*' -X POST -H "Authorization: ..." -d @payload.json ...` можно дать Claude Code набор typed-tools и работать с Flowise одной строкой:

> «Найди в catalog-aquaphor смесители для кухни» → Claude дёргает `flowise_docstore_query` → возвращает top-K docs.
> «Создай Document Store catalog-aquaphor-v2 с теми же loader'ом и embedding'ом, но HNSW индексом» → Claude дёргает несколько tools программно.

Также — нет официального MCP-сервера от Flowise (см. `docs/architecture/decisions/008-flowise-mcp.md`, ADR-008 будет создан после первой устойчивой версии). Community-варианты неполные (см. сравнение в lab journal). Свой — единственный путь к стабильному tooling.

## Стек

- **Runtime**: Node.js ≥ 24.15 (как у slovo)
- **Язык**: TypeScript 6.x, strict mode, no-any
- **MCP SDK**: `@modelcontextprotocol/sdk` (official Anthropic)
- **Валидация**: `zod` v4 (уже в slovo deps)
- **HTTP**: встроенный `fetch` (Node.js 24+)
- **Тесты**: Jest (как остальной slovo — `*.spec.ts`)
- **Запуск dev**: `npx tsx libs/mcp-flowise/src/index.ts` (без билда)

## Структура

```
libs/mcp-flowise/
├── package.json
├── tsconfig.lib.json
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
        ├── index.ts               # реестр TToolDefinition
        ├── t-tool.ts              # типы TToolResult, TToolHandler, TToolDefinition
        ├── ping.ts                # flowise_ping
        ├── credentials.ts         # flowise_credentials_list
        └── docstore.ts            # flowise_docstore_list + flowise_docstore_query
```

Соглашения:
- **Имена tools** — `flowise_<verb>_<resource>` (snake_case, как требует MCP SDK).
- **Типы** — префикс `T`, файлы чистых типов с префиксом `t-` (правило slovo `feedback_type_conventions`).
- **4 пробела** во всех файлах (правило slovo).
- Никакого `any`, унифицированный `TToolResult<T> = { success, data, error }`.

## Env

Добавлены в `libs/common/src/config/env.schema.ts`:

| Var | Default | Описание |
|---|---|---|
| `FLOWISE_API_URL` | `http://127.0.0.1:3130` | URL Flowise (для slovo dev — port из `docker-compose.infra.yml`) |
| `FLOWISE_API_KEY` | `''` | Bearer token из Flowise UI → Credentials → API Keys. Если пустой — все RBAC-protected endpoint'ы упадут с 401 |

Получить ключ: в Flowise UI (http://127.0.0.1:3130) → левый sidebar → **API Keys** → **+ Create Key** → permissions `documentStores:*`, `chatflows:*`, `credentials:view` (минимум для нашего MVP).

## Запуск

### Локально для dev-проверки (smoke без Claude Code)

```bash
# из корня slovo — initialize + tools/list одной командой
{
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.1"}}}'
  echo '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  echo '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
} | node --env-file=.env node_modules/tsx/dist/cli.mjs libs/mcp-flowise/src/index.ts
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
                "libs/mcp-flowise/src/index.ts"
            ]
        }
    }
}
```

`node --env-file=.env` — нативный флаг Node 20.6+ — читает slovo `.env` при запуске MCP-сервера и проставляет env переменные процессу. Никакого dotenv-пакета и никакой `${VAR}` подстановки в `.mcp.json` (Claude Code такие не резолвит из `.env`, только из системного env).

После рестарта Claude Code в диалоге появятся tools `mcp__flowise-slovo__flowise_*`.

## Доступные tools (MVP, вечер 1)

| Tool | Описание | Пример вызова |
|---|---|---|
| `flowise_ping` | health-check Flowise (`GET /api/v1/ping`) | без параметров |
| `flowise_credentials_list` | список credentials с id и type | без параметров (используется для discovery credentialId) |
| `flowise_docstore_list` | список Document Stores | без параметров |
| `flowise_docstore_query` | retrieval-search в Document Store без LLM (`POST /api/v1/document-store/vectorstore/query`) | `{ storeId, query }` |

Расширение по факту использования. Roadmap см. в `docs/integrations/flowise-mcp.md` (будет создан после MVP).

## Reference — где что копать

- **Flowise REST endpoints**: `/usr/local/lib/node_modules/flowise/dist/routes/<feature>/index.js` внутри `slovo-flowise` контейнера. Через `docker exec slovo-flowise sh -c "cat ..."`. Правило `feedback_read_flowise_source` в memory.
- **Payload schemas**: `dist/services/<feature>/index.js` — там видно какие поля передавать в `loaderConfig`/`splitterConfig` и т.д.
- **MCP TypeScript SDK**: https://github.com/modelcontextprotocol/typescript-sdk (`McpServer`, `StdioServerTransport`, `registerTool`).
- **MCP Spec**: https://spec.modelcontextprotocol.io/
- **Lab journal с reproducible recipe**: `docs/experiments/vision-catalog/2026-04-29-document-store-vector-pipeline.md` день 2 — там полный набор curl-команд которые этот MCP-сервер заменяет.
- **Референс архитектуры**: `C:\Users\Diamond\Desktop\mcp-moysklad` — наш предыдущий MCP-сервер на том же стеке. Tools registry, ToolResult shape, retry+throttle client — копируется паттерн 1:1.

## Тесты

```bash
# из корня slovo
npm test -- libs/mcp-flowise
```

Покрытие — Jest конфиг в root package.json подхватит `libs/mcp-flowise/**/*.spec.ts` автоматом.

## Roadmap (по факту использования, не сразу всё)

- **MVP (вечер 1)** — ping, credentials_list, docstore_list, docstore_query.
- **Phase 1** — `prediction_run` (chatflow predictions, в т.ч. с image uploads через base64), `docstore_upsert` (для `apps/worker/catalog-refresh`), `docstore_refresh` (cron), `chatflow_list/get`.
- **Phase 2** — `chatflow_create/update/delete` (программная генерация флоу), `node_list/get` (discovery node specs), `variable_*`, `tool_*`.
- **Production** — отдельный `extract` в `mcp-flowise` репо если соберёмся публиковать в npm/Smithery. До тех пор живёт в slovo monorepo.
