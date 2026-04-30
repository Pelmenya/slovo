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

- **Maintenance load.** При апгрейде Flowise (3.1 → 3.2) нужно проверять REST-совместимость (~1 час раз в месяц). Mitigated CI smoke-тестами против реального dev-инстанса (TODO).
- **Не покрывает 100% Flowise REST сразу.** MVP — 4 tools (ping, credentials_list, docstore_list, docstore_query). Расширение по факту использования (Phase 1 PR6 + автогенерация флоу).
- **Не публикуется в npm/Smithery в MVP.** Польза для community отложена до устойчивой версии.

## Когда пересмотреть

- **Если Flowise выпустит официальный MCP-сервер** — заменить наш на него, оставив только slovo-specific обёртки.
- **Если scope вырастет до 30+ tools и стабилизируется** — extract в отдельный репо `Pelmenya/mcp-flowise`, опубликовать в npm + Smithery (см. tech-debt).
- **Если появится проблема перфоманса** — переход на native Rust/Go MCP server (вряд ли нужно, stdio-overhead нулевой).

## Связанные ADR

- **ADR-001** (Modular Monolith) — `apps/mcp-flowise/` это standalone executable в monorepo, не nest-app, но вписывается в архитектуру (apps/* = исполняемые артефакты).
- **ADR-006** (Knowledge Base) и **ADR-007** (Catalog ingest) — оба полагаются на Flowise как LLM runtime; MCP-сервер ускоряет работу с этим runtime во время разработки.
- **`feedback_flowise_full_api_coverage`** в memory — основание для решения «всё через REST».
- **`feedback_minimal_deps_proven`** в memory — обоснование выбора `@modelcontextprotocol/sdk` (official) + thin wrapper, а не community-обёрток.
