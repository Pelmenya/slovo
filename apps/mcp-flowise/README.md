# @slovo/mcp-flowise

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-2025--11--25-blue)](https://modelcontextprotocol.io/specification/2025-11-25)
[![Flowise](https://img.shields.io/badge/Flowise-3.1+-purple)](https://flowiseai.com)

**MCP-сервер для управления Flowise REST API из Claude Code и любого MCP-клиента.** 66 tools, полное зеркало Flowise REST: Document Stores (22), Chatflows (6), Nodes discovery (2), Predictions с uploads (1), Credentials (5), Variables (4), Custom Tools (5), Assistants (5), Chat history (3), Vector legacy (1), Attachments (1), Upsert history (2), Composite (3 — `chatflow_clone`, `docstore_clone`, `docstore_full_setup`), DX helpers (3 — `introspect`, `smoke`, `docstore_search_by_name`), Misc (3).

Standalone-приложение в slovo monorepo (`apps/mcp-flowise/`), готовое к extract в отдельный репо `Pelmenya/mcp-flowise` и публикации в npm/Smithery (см. ADR-008 amendment).

## Зачем

Flowise полностью покрыт REST API (`Authorization: Bearer <apiKey>`), но **нет официального MCP-сервера** от вендора. Community-варианты неполные (см. ADR-008 — анализ `matthewhand/mcp-flowise`, `wksbx/flowise-mcp-server`, `MilesP46/FlowiseAI-MCP`). Свой MCP даёт **typed tools** для Claude Code вместо ручного `curl --noproxy '*' -X POST -H "Authorization: ..." -d @payload.json ...`:

```text
Раньше: 4 curl-команды для одного docstore upsert (loader/save → process → vectorstore/save → insert)
Теперь: одна tool-call строка `flowise_docstore_upsert({ storeId, docId })`
```

## Содержание

- [Установка и запуск](#установка-и-запуск)
- [Подключение к Claude Code](#подключение-к-claude-code)
- [Tools — полный список с примерами](#tools--полный-список-с-примерами)
- [Структура проекта](#структура-проекта)
- [Разработка](#разработка)
- [Reference](#reference)

## Установка и запуск

### Требования

- Node.js ≥ 20.6 (для нативного `--env-file`)
- Запущенный Flowise ≥ 3.1 (slovo dev: http://127.0.0.1:3130 через `docker-compose.infra.yml`)
- Flowise API key — Flowise UI → API Keys → **+ Create Key** с permissions `documentStores:*`, `chatflows:*`, `credentials:view` (минимум — `*:view` для всех ресурсов которые планируешь читать)

### Env

| Var | Default | Описание |
|---|---|---|
| `FLOWISE_API_URL` | `http://127.0.0.1:3130` | URL Flowise instance |
| `FLOWISE_API_KEY` | — обязательно | Bearer token из Flowise UI |
| `FLOWISE_REQUEST_TIMEOUT_MS` | `30000` | Таймаут одного HTTP-запроса |
| `FLOWISE_THROTTLE_MS` | `50` | Минимальный интервал между запросами (rate-limit) |
| `FLOWISE_MAX_RETRIES` | `3` | Сколько раз ретраить на 429 / network errors |

### Запуск как часть slovo monorepo

```bash
# из корня slovo
node --env-file=.env node_modules/tsx/dist/cli.mjs apps/mcp-flowise/src/index.ts
```

`node --env-file=.env` — нативный флаг Node 20.6+ — подхватывает env из slovo `.env` без `dotenv` пакета.

### Сборка standalone (после extract в свой репо)

```bash
npm install
npm run build      # → dist/index.js, dist/index.d.ts
npm start          # запуск из dist
```

`prepublishOnly` хук прогонит `lint + test + build` перед `npm publish`.

## Подключение к Claude Code

Project-level конфиг — `slovo/.mcp.json` (коммитится в репо без секретов):

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

После рестарта Claude Code в диалоге появятся tools `mcp__flowise-slovo__flowise_*`.

**Личный override** — добавить блок в `~/.claude.json`. Project-level имеет более низкий приоритет, перетирается user-level конфигом.

## Tools — полный список с примерами

> Все tools принимают JSON-объект, возвращают `{ success: true, data }` или `{ success: false, error }`. Под каждым примером — то что Claude отправляет MCP-серверу.

### Misc

#### `flowise_ping`

Health-check Flowise + проверка валидности API key.

```json
{}
```

### Credentials (5)

| Tool | Описание |
|---|---|
| `flowise_credentials_list` | Список credentials (опц. фильтр по `credentialName`) |
| `flowise_credentials_get` | Детали credential по id |
| `flowise_credentials_create` | Создать credential (Flowise зашифрует `plainDataObj`) |
| `flowise_credentials_update` | Обновить (name / plainDataObj) |
| `flowise_credentials_delete` | Удалить |

```json
// Discovery — найти все AWS-credentials для S3 Loader
{ "credentialName": "awsApi" }

// Создать новую OpenAI credential
{
    "name": "openai-prod",
    "credentialName": "openAIApi",
    "plainDataObj": { "openAIApiKey": "sk-..." }
}
```

### Document Stores — CRUD (5)

| Tool | Описание |
|---|---|
| `flowise_docstore_list` | Сводка по всем DocStore (id, name, status, totalChunks) |
| `flowise_docstore_get` | Детали DocStore с loader-ами + embedding/vectorstore configs |
| `flowise_docstore_create` | Создать пустой DocStore (без loader-ов) |
| `flowise_docstore_update` | Обновить name / description |
| `flowise_docstore_delete` | Удалить (необратимо, со всеми loader-ами и chunks) |

```json
// Создать DocStore для каталога Аквафор
{ "name": "catalog-aquaphor", "description": "Каталог товаров для semantic search" }

// Получить детали
{ "storeId": "aec6b741-8610-4f98-9f5c-bc829dc41a96" }
```

### Document Stores — Operations (2)

| Tool | Описание |
|---|---|
| `flowise_docstore_upsert` | Полный 4-step ingest (process + embed + insert) одним вызовом |
| `flowise_docstore_refresh` | Re-process всех loader-ов + re-embed (для cron 4ч обновления) |

```json
// Refresh каталога — slovo apps/worker/catalog-refresh
{ "storeId": "aec6b741-..." }

// Upsert с переопределением loader-конфига
{
    "storeId": "aec6b741-...",
    "docId": "loader-uuid-from-loader-save",
    "overrideConfig": { "metadata": "{\"source\":\"manual-refresh\"}" }
}
```

### Document Stores — Loaders (4)

| Tool | Описание |
|---|---|
| `flowise_docstore_loader_save` | Создать/обновить loader (S3, PDF, JSON, Web, и т.д.) |
| `flowise_docstore_loader_process` | Запустить chunking — читает источник, режет splitter'ом, сохраняет chunks (без embedding!) |
| `flowise_docstore_loader_preview` | Preview chunks без сохранения — sanity check конфигурации |
| `flowise_docstore_loader_delete` | Удалить loader со всеми его chunks |

```json
// Сохранить S3 Loader для MinIO bucket
{
    "storeId": "aec6b741-...",
    "loaderId": "S3",
    "loaderName": "S3",
    "credential": "56f648d8-36bc-4885-a3cf-f79f796e7674",
    "loaderConfig": {
        "bucketName": "slovo-datasets",
        "keyName": "catalogs/aquaphor/latest.json",
        "region": "us-east-1",
        "fileProcessingMethod": "builtIn",
        "metadata": "{\"externalId\":\"/externalId\",\"name\":\"/name\"}"
    },
    "splitterId": "recursiveCharacterTextSplitter",
    "splitterName": "Recursive Character Text Splitter",
    "splitterConfig": { "chunkSize": 1000, "chunkOverlap": 200 }
}

// Запустить chunking (после loader_save)
{ "storeId": "aec6b741-...", "loaderId": "c8fbef8f-..." }
```

### Document Stores — Chunks (3)

| Tool | Описание |
|---|---|
| `flowise_docstore_chunks_list` | Постраничный список chunks конкретного loader |
| `flowise_docstore_chunk_update` | Обновить pageContent / metadata одного chunk (не re-process) |
| `flowise_docstore_chunk_delete` | Удалить один chunk |

```json
// Прочитать chunks loader-а постранично
{ "storeId": "aec6b741-...", "fileId": "c8fbef8f-...", "pageNo": 1 }

// Поправить опечатку в chunk без полного re-process
{
    "storeId": "aec6b741-...",
    "loaderId": "c8fbef8f-...",
    "chunkId": "f00e92b9-874e-4faf-8b34-47f006d41139",
    "pageContent": "Исправленный текст",
    "metadata": { "fixed": true }
}
```

### Document Stores — Vector Store (5)

| Tool | Описание |
|---|---|
| `flowise_docstore_query` | **Retrieval без LLM** (~150-500ms vs ~1500-5000ms у Chatflow+LLM) |
| `flowise_docstore_vectorstore_save` | Сохранить embedding+vectorstore конфиг (без insert) |
| `flowise_docstore_vectorstore_insert` | Embed + INSERT chunks в vectorstore (Postgres/Pinecone/...) |
| `flowise_docstore_vectorstore_update` | Обновить только конфиг |
| `flowise_docstore_vectorstore_delete` | Удалить data из vectorstore (Document Store остаётся) |

```json
// Главный search — слой apps/api/catalog/search/text
{ "storeId": "aec6b741-...", "query": "смесители для кухни", "topK": 5 }

// Сохранить embedding + vector store конфиг
{
    "storeId": "aec6b741-...",
    "embeddingName": "openAIEmbeddings",
    "embeddingConfig": {
        "credential": "50796497-...",
        "modelName": "text-embedding-3-small",
        "dimensions": 1536
    },
    "vectorStoreName": "postgres",
    "vectorStoreConfig": {
        "credential": "65d7f839-...",
        "host": "slovo-postgres",
        "database": "slovo",
        "port": 5432,
        "tableName": "catalog_chunks"
    }
}
```

### Document Stores — Components Discovery (4)

| Tool | Описание |
|---|---|
| `flowise_docstore_components_loaders` | Все Document Loader nodes (S3, PDF, JSON, Web, GitHub, ...) с inputs schema |
| `flowise_docstore_components_embeddings` | Все embedding providers (OpenAI / Cohere / VoyageAI / Azure / ...) |
| `flowise_docstore_components_vectorstore` | Все vectorstore providers (Postgres/pgvector, Pinecone, Qdrant, ...) |
| `flowise_docstore_components_recordmanager` | Record Manager providers (для idempotent upserts) |

```json
// Discovery — узнать какие loader nodes доступны и их inputs
{}
```

### Chatflows (6)

| Tool | Описание |
|---|---|
| `flowise_chatflow_list` | Список с фильтром по `type` (CHATFLOW/AGENTFLOW/MULTIAGENT/ASSISTANT) |
| `flowise_chatflow_get` | Детали (опц. `includeFlowData=true` для полного экспорта) |
| `flowise_chatflow_get_by_apikey` | Список по конкретному API key |
| `flowise_chatflow_create` | Создать с готовым flowData JSON |
| `flowise_chatflow_update` | Обновить (name, flowData, deployed, isPublic) |
| `flowise_chatflow_delete` | Удалить |

```json
// Список всех CHATFLOW (без AgentFlow и пр.)
{ "type": "CHATFLOW" }

// Детали с flowData (для clone)
{ "chatflowId": "991f9b70-...", "includeFlowData": true }

// Создать новый chatflow программно (Phase 2 — autogen из Claude)
{
    "name": "vision-catalog-describer-v2",
    "type": "CHATFLOW",
    "flowData": "{\"nodes\":[...],\"edges\":[...]}",
    "deployed": false,
    "isPublic": false
}
```

### Nodes Discovery (2)

| Tool | Описание |
|---|---|
| `flowise_nodes_list` | Все ноды (опц. фильтр по category) — Chat Models, Embeddings, Document Loaders, Tools, Vector Stores, ... |
| `flowise_nodes_get` | Детальная schema конкретной ноды (inputs/outputs/credential) |

```json
// Все Chat Models (Anthropic, OpenAI, Bedrock, Gemini, Ollama, ...)
{ "category": "Chat Models" }

// Schema конкретной ноды для chatflow_create
{ "name": "chatAnthropic" }
```

### Predictions (1)

| Tool | Описание |
|---|---|
| `flowise_prediction_run` | Запуск Chatflow с question/form/uploads/history |

```json
// Текстовый запрос
{
    "chatflowId": "2e016504-...",
    "question": "Какие смесители есть?"
}

// Vision — image search через base64
{
    "chatflowId": "991f9b70-...",
    "question": "Опиши товар на фото",
    "uploads": [{
        "data": "data:image/png;base64,iVBORw0KGgo...",
        "type": "file",
        "name": "c125.png",
        "mime": "image/png"
    }]
}

// AgentFlow V2 с form input
{
    "chatflowId": "...",
    "form": { "topic": "вода", "depth": "deep" }
}
```

### Variables (4)

Runtime/static переменные для подстановки в промпты через `{{varname}}`.

| Tool | Описание |
|---|---|
| `flowise_variables_list` | Все переменные |
| `flowise_variables_create` | Создать (`type=static` — фиксированное, `runtime` — подставляется при каждом prediction) |
| `flowise_variables_update` | Обновить |
| `flowise_variables_delete` | Удалить |

```json
{ "name": "company_name", "value": "Аквафор", "type": "static" }
```

### Custom Tools (5)

JS-функции с zod-schema, используются как tools для агентов.

| Tool | Описание |
|---|---|
| `flowise_custom_tools_list` | Все Custom Tools |
| `flowise_custom_tools_get` | Детали (schema arguments + func body) |
| `flowise_custom_tools_create` | Создать |
| `flowise_custom_tools_update` | Обновить |
| `flowise_custom_tools_delete` | Удалить |

```json
// Создать tool для апи погоды
{
    "name": "get_weather",
    "description": "Get current weather by city",
    "schema": "{\"type\":\"object\",\"properties\":{\"city\":{\"type\":\"string\"}},\"required\":[\"city\"]}",
    "func": "const r = await fetch(`https://api.weather.com/${$city}`); return r.json();"
}
```

### Assistants (5)

OpenAI Assistants / Azure Assistants / Custom-обёртки.

| Tool | Описание |
|---|---|
| `flowise_assistants_list` | Все ассистенты с фильтром по `type` |
| `flowise_assistants_get` | Детали |
| `flowise_assistants_create` | Создать (details — JSON с instructions/model/tools) |
| `flowise_assistants_update` | Обновить |
| `flowise_assistants_delete` | Удалить |

```json
{ "type": "OPENAI" }
```

### Chat History + Audit (2)

| Tool | Описание |
|---|---|
| `flowise_chatmessage_list` | История диалогов конкретного Chatflow с фильтрами |
| `flowise_upsert_history_list` | История upsert операций (когда и как embed обновлялся) |

```json
// Дебаг диалогов конкретной сессии
{ "chatflowId": "2e016504-...", "chatId": "user-session-id", "limit": 50 }
```

## Структура проекта

```
apps/mcp-flowise/
├── package.json                      # publish-ready (description, keywords, repo, bin, main, scripts)
├── tsconfig.build.json               # tsc → dist/ (declarations + source maps)
├── README.md                          # эта дока
├── LICENSE                            # MIT
└── src/
    ├── index.ts                       # entry: runServer().catch(...)
    ├── server.ts                      # McpServer + StdioServerTransport + tools loop
    ├── config.ts                      # env validation (FLOWISE_API_URL + FLOWISE_API_KEY)
    ├── api/
    │   ├── client.ts                  # FlowiseClient: fetch + bearer + retry на 429 + throttle
    │   ├── endpoints.ts               # константы REST путей
    │   └── t-flowise.ts               # типы (TDocumentStore, TCredential, TChatflow, ...)
    ├── utils/
    │   └── errors.ts                  # FlowiseError + formatErrorForMcp
    └── tools/
        ├── _helpers.ts                # withErrorHandling + общие маперы
        ├── index.ts                   # реестр 54 tools (satisfies TToolDefinition<TIn, TOut>)
        ├── t-tool.ts                  # типы TToolResult, TToolDefinition
        ├── ping.ts
        ├── credentials.ts             # 5 tools
        ├── docstore.ts                # 22 tools (самый крупный resource-файл)
        ├── chatflow.ts                # 6 tools
        ├── nodes.ts                   # 2 tools
        ├── prediction.ts              # 1 tool (с uploads)
        ├── variables.ts               # 4 tools
        ├── custom-tools.ts            # 5 tools
        ├── assistants.ts              # 5 tools
        ├── chatmessage.ts             # 1 tool
        └── upsert-history.ts          # 1 tool
```

Соглашения:
- **Tool naming** — `flowise_<verb>_<resource>` (snake_case, требование MCP SDK).
- **Типы** — префикс `T`, файлы чистых типов с префиксом `t-`.
- **Code style** — 4 пробела, `type` only (никаких `interface`), no `any`, унифицированный `TToolResult<T> = { success, data, error }`.

## Разработка

### Тесты

```bash
# из корня slovo
npm test -- apps/mcp-flowise

# или из apps/mcp-flowise
npm test
```

Покрытие — 100% tools имеют unit-тесты (mock fetch + happy + 4xx/5xx error cases). Все 54 tools покрыты.

### Линтер

```bash
npm run lint              # из apps/mcp-flowise — apps/mcp-flowise/src
npm run lint              # из корня slovo — все apps + libs
```

### Сборка

```bash
cd apps/mcp-flowise
npm run build             # → dist/
```

`tsconfig.build.json` исключает `*.spec.ts` и `__test-helpers__/`. Только source попадает в bundle.

## FAQ

### Anthropic prompt caching через `flowise_prediction_run`?

Нет — Flowise 3.1.2 ChatAnthropic node (version=8) не поддерживает `cache_control: { type: "ephemeral" }` блоки. Подтверждено source-scan'ом (`/usr/local/lib/node_modules/flowise/node_modules/flowise-components/dist/nodes/chatmodels/ChatAnthropic/ChatAnthropic.js` — нет упоминаний `cache_control`/`cacheControl`/`ephemeral`). Upstream issue [#4289](https://github.com/FlowiseAI/Flowise/issues/4289) (Apr 2025) и [#4634](https://github.com/FlowiseAI/Flowise/issues/4634) (Jun 2025) — open без движения.

`overrideConfig` в `flowise_prediction_run` принимает произвольный `Record<string, unknown>`, но Flowise не пропускает unknown ключи дальше в Anthropic SDK без node-side mapping'а.

**Workaround'ы для slovo:**
1. **Гибрид через `libs/llm`** — retrieval через `flowise_docstore_query` (без LLM, ~300ms) → генерация через прямой Anthropic SDK с native `cache_control`. План в `docs/features/knowledge-base.md`.
2. **Transparent proxy** — [montevive/autocache](https://github.com/montevive/autocache) (Go, MIT, ~70 ⭐ apr 2026) встаёт между Flowise и Anthropic API, инжектит `cache_control` автоматически. Drop-in без переписывания libs/llm. Точно поддерживает Flowise по их README. Не тестировано в slovo — оценка в tech-debt.

## Reference

- **Flowise REST endpoints** — `/usr/local/lib/node_modules/flowise/dist/routes/<feature>/index.js` внутри Flowise контейнера. Через `docker exec slovo-flowise sh -c "cat ..."`.
- **Payload schemas** — `dist/services/<feature>/index.js` — там видно какие поля передавать в body.
- **MCP TypeScript SDK** — https://github.com/modelcontextprotocol/typescript-sdk
- **MCP Spec (latest)** — https://modelcontextprotocol.io/specification/2025-11-25
- **Flowise docs** — https://docs.flowiseai.com/api-reference (частичное покрытие — лезь в исходник при сомнениях)
- **ADR-008** — `docs/architecture/decisions/008-flowise-mcp.md` — обоснование выбора self-built + план extract
- **Прецедент архитектуры** — `https://github.com/Pelmenya/mcp-moysklad` — наш предыдущий MCP-сервер на том же стеке

## Roadmap

См. `docs/architecture/tech-debt.md` секция **C. MCP-сервер Flowise**:

- ✅ Полное покрытие 66 tools (commit `ba3b555` + follow-up'ы)
- ✅ 100% unit-test coverage
- ✅ publish-ready package (build, prepublishOnly, MIT, repository, bin)
- ⏳ CI smoke против реального Flowise dev-инстанса (cron weekly)
- ⏳ `chatflow_create` flowData builder utility (`libs/flowise-flowdata/`) — для Phase 2 chatflow autogen
- ⏳ Extract в `Pelmenya/mcp-flowise` + npm/Smithery publish — по триггерам из ADR-008

## Версионирование

[Semantic Versioning](https://semver.org/):
- **MAJOR** — breaking changes в схеме tool-input или формате response
- **MINOR** — новый tool / новое поле в схеме / non-breaking фикс
- **PATCH** — bug fix, документация, refactor

Текущая версия — `0.1.0` (после расширения до 54 tools, готовность к extract).

## Лицензия

[MIT](LICENSE) © 2026 Dmitry Lyapin (Pelmenya)
