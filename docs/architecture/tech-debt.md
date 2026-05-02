# Технический долг

> Список hardening-задач, отложенных осознанно. Закрываем к моменту соответствующей вехи.
> Чек-лист на каждый PR, затрагивающий эти зоны — свериться; при закрытии задачи — удалить пункт.

Обновлено: 2026-05-01 (после уточнения сценария запуска — открытый каталог prostor-app).

---

## ⚠️ Pre-launch blockers — публичный запуск prostor-app

**Контекст (2026-05-01):** prostor-app мигрирует с Telegram mini-app, каталог поиска **открытый** (без логина для клиентов и менеджеров). Без перечисленных мер anonymous traffic выедает Vision-бюджет за часы.

| # | Что | Где | Статус |
|---|---|---|---|
| **A** | Per-IP/IPv6-/64-subnet rate limit на `/catalog/search/*` (anonymous text 30/min, image 3/min) | См. **#21** «Что НЕ сделано (отложено) → Per-IPv6-subnet throttle» | ⏳ TODO |
| **B** | SHA256-кэш повторных image-запросов (`slovo:vision:cache:<sha256>` TTL 24ч) | См. **#35** ниже | ⏳ TODO |
| **C** | UX-loader при image-search (Vision 6-7 сек) — спиннер/skeleton | См. `docs/management/vision-catalog-handoff.md` (фронт-задача) | ⏳ TODO |
| **D** | Telegram/email alert на budget-cap exhaustion (а не только 503 на endpoint'е) | Расширить `apps/api/src/modules/budget/` | ⏳ TODO |
| **E** | Webhook-trigger для catalog-refresh (заменить cron 4ч → push от CRM при write в MinIO) | См. **#37** ниже + ADR-007 amendment | ⏳ TODO (enhancement, не security blocker) |

Пункты A-D обязательны до Phase 2 (публичный запуск) — без них либо abuse через Vision API, либо клиент с долгой image-search'ой бьёт «обновить» и удваивает cost, либо мы узнаём о превышении бюджета только через клиентскую жалобу.

Пункт E (webhook) — желательно вместе с A-D, но не security-blocker. Можно жить с 4ч-задержкой первую неделю в prod, потом выкатить когда соберём метрики реальной частоты обновлений.

---

## До auth-модуля (первый PR с JWT)

### 1. Валидация env-переменных на старте в production

В `ConfigModule.forRoot({ validationSchema })` добавить Joi/zod схему, которая падает в `NODE_ENV=production` если:

- `JWT_SECRET === 'change_me_in_production'` или `length < 32`
- `POSTGRES_PASSWORD` / `RABBITMQ_PASSWORD` / `LANGFUSE_POSTGRES_PASSWORD` равны дефолтам `*_dev_password_change_me`
- `CORS_ORIGIN` содержит `*`
- `LANGFUSE_NEXTAUTH_SECRET` / `LANGFUSE_SALT` / `LANGFUSE_ENCRYPTION_KEY` пустые или короче 64 hex-символов

Либо — кастомный check в `main.ts` / `bootstrap()` до `listen()`.

### 2. Pino-logger `redact` ✅ ЗАКРЫТО (PR4 hardening)

Реализовано в `libs/common/src/logger/app-logger.module.ts`: redact paths для `authorization`, `cookie`, `x-user-id`, `x-api-key`, `password`, `rawText`, `extractedText`, `*.apiKey`, `*.secret`. Censor: `[REDACTED]`.

<details>
<summary>Старое описание</summary>

В `LoggerModule.forRootAsync(...)` (`app.module.ts`) добавить:

```ts
pinoHttp: {
    redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'req.body.password', '*.apiKey', '*.secret'],
        censor: '[REDACTED]',
    },
    // ...
}
```

</details>

### 3. Отдельный throttle для `/auth/login`

5 req/min по IP — защита от brute-force. Через `@Throttle({ default: { limit: 5, ttl: 60000 } })` на контроллере.

---

## До первой LLM-фичи

### 4. Throttle для LLM-endpoint'ов

`@Throttle({ default: { limit: 5, ttl: 60000 } })` на роутах, которые тратят токены Claude — иначе абьюз сожжёт бюджет.

### 5. Langfuse wrapping всех LLM-вызовов

ADR-004 (Claude как primary) без observability нежизнеспособен в проде. Обязательно обернуть `client.messages.create(...)` в `langfuse.generation()` с тегированием `userId`.

---

## До первого прод-деплоя

### 6. `strictPropertyInitialization`

Сейчас `false` глобально ради `libs/database/src/generated/*` DTO (`prisma-generator-nestjs-dto` не ставит initializers). Варианты:

- (a) Вернуть `true`, найти опцию генератора для `!:` на полях или post-process script.
- (b) Оставить `false` с явной пометкой в этом файле. **Сейчас: (b).**

### 7. Pool tuning для Prisma/pg

`new PrismaPg({ connectionString, max: N, idleTimeoutMillis: 30000 })`. До первого нагрузочного теста — дефолты ок. Перед прод-выкаткой — настроить, зафиксировать в ADR.

### 8. TS project references

Если появится второй app (`apps/worker/`) и он начнёт активно использовать `libs/`. Сейчас `rootDir: "../.."` в `apps/api/tsconfig.app.json` достаточно.

### 9. `valkey --requirepass`

Для `127.0.0.1` не нужен. При выносе инфры на VPS — обязательно добавить `command: valkey-server --appendonly yes --requirepass ${REDIS_PASSWORD}` и заполнить `REDIS_PASSWORD` в prod `.env`.

### 10. `CORS_ORIGIN` в проде

Список конкретных доменов через запятую (код уже поддерживает split/trim), `*` категорически запрещён при `credentials: true`. При деплое — в prod `.env` должен быть `https://app.slovo.ai,https://admin.slovo.ai` (пример).

### 11. Swagger UI в prod

Сейчас скрыт через `if (NODE_ENV !== 'production')` в `main.ts`. Если потребуется открыть для внешней интеграции — прикрыть basic-auth (`express-basic-auth`), **не** публичить безусловно.

### 12. S3/MinIO: SSE + presigned URLs + IAM hardening

`storage_key` в `knowledge_sources` хранится как opaque UUID-path в открытом виде — это ок, защита на уровне бакета. Перед прод-деплоем:

- **Encryption at rest** — для MinIO: `MINIO_KMS_AUTO_ENCRYPTION=on` + `MINIO_KMS_KES_*` (или хотя бы SSE-S3 с managed key). Для AWS S3 — bucket policy с `"s3:x-amz-server-side-encryption": "AES256"`, `Deny` на put без SSE-header.
- **Presigned URLs на download** — никогда не отдавать storage_key клиенту как публичный URL; выдавать presigned через `@aws-sdk/s3-request-presigner` с TTL 5–15 минут.
- **Bucket policy — private-only** — `"PublicAccessBlockConfiguration": all true`. Отдельный бакет для user-uploads vs публичных ассетов.
- **IAM policy — narrow scope.** У API-credentials только `s3:GetObject` / `s3:PutObject` / `s3:DeleteObject` на конкретный префикс `sources/*` в конкретном бакете. **Без** `s3:*`, `s3:ListAllMyBuckets`, `s3:DeleteBucket`. Через [Condition `StringLike` на `s3:prefix`](https://docs.aws.amazon.com/AmazonS3/latest/userguide/walkthrough1.html) ограничить что можно trogать.
- **Bucket CORS policy** — если presigned URLs используются из браузера, `AllowedOrigins = CORS_ORIGIN` (конкретный список), не `*`. Методы — только `GET` для download, `PUT` для upload (если используется direct-upload presigned).
- **MIME-validation на upload** — клиент может подставить любой `Content-Type` в presigned PUT. В NestJS endpoint'е (который выдаёт presigned URL) валидировать что requested content-type в whitelist `['video/mp4', 'video/webm', 'audio/mpeg', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain']`. Чтобы юзер не залил `.exe` как `text/plain` в обход фильтров.
- **Server access logging** — отдельный audit-бакет с 90-дневным lifecycle. Для диагностики утечек presigned URLs и compliance.
- **Object Lock / Versioning** — опционально для дорогих user-данных (видео-сырьё): защита от случайного/злонамеренного `DELETE` и ransomware-сценариев.
- **`S3_FORCE_PATH_STYLE=false` в prod** — для AWS S3 / Cloudflare R2 правильный режим — virtual-hosted style. MinIO в dev использует path-style. Проверить prod `.env` при деплое, добавить комментарий в `.env.example`.
- **PII в metadata** — если в `metadata` JSONB начнём складывать user-generated данные с PII (имена авторов, транскрипты), свериться с pino `redact` и уровнем логирования.

### 13. Knowledge Base — Domain DTO через PickType/OmitType ✅ ЗАКРЫТО (PR4)

Сделали даже лучше: не `PickType(generated)`, а чистые domain-DTO в `apps/api/src/modules/knowledge/dto/*` (`CreateTextSourceRequestDto`, `KnowledgeSourceResponseDto`, `ListKnowledgeSourcesQueryDto`, `PaginatedKnowledgeSourcesResponseDto`). Internal поля (`userId`, `status`, `progress`, `startedAt`, `completedAt`, `error`, `sourceType`, `storageKey`, `rawText`) от клиента не принимаются и в response не отдаются. E2E-тест `forbidNonWhitelisted` это проверяет.

<details>
<summary>Исходные риски (исторически)</summary>

`prisma-generator-nestjs-dto` сгенерировал CRUD-DTO (`libs/database/src/generated/knowledge-source/dto/*`) которые **нельзя** использовать напрямую в контроллерах. Риски, которые закроем при вводе `KnowledgeController`:

- `CreateKnowledgeSourceDto.userId` — клиент подставит чужой UUID и загрузит источник в чужой профиль. Правильно: `userId` берётся из `req.user.id` в guard'е, в API-DTO поля нет.
- `CreateKnowledgeSourceDto.startedAt` / `completedAt` — lifecycle-поля, ставит worker. Клиент не должен их передавать.
- `UpdateKnowledgeSourceDto.sourceType` — тип источника иммутабелен, смена ломает ingestion-адаптер. Запретить на уровне DTO (не в PATCH).
- `UpdateKnowledgeSourceDto.status` / `progress` / `error` — ставит worker, не клиент.

**Решение при вводе контроллера (Phase 1 PR4):** собственные `CreateKnowledgeSourceRequestDto` через `PickType` (только user-safe поля) и `KnowledgeSourceResponseDto` через `OmitType`. Сгенерированные DTO использовать только как internal write-model для Prisma.

</details>

### 14. `sanitizeIngestionError` перед записью в `knowledge_sources.error`

Сырые ошибки от AWS SDK / Groq / Anthropic / pdf-parse могут содержать секреты и PII:
- `X-Amz-Signature=...` (presigned URL в stack-trace при 404)
- `Authorization: Bearer ...` / `sk-ant-...` / `AKIA[0-9A-Z]{16}`
- Фрагменты user-payload (PII в тексте документа) из парсеров

Helper `sanitizeIngestionError(err: unknown): string` в `libs/common/` уже реализован (см. `libs/common/src/errors/sanitize-ingestion-error.ts`). При вводе `KnowledgeSourceService` **обязательно** применять его перед записью в `error` поле, не класть raw `err.message`.

### 15. `KnowledgeSource.metadata` — zod-валидация

Поле `metadata Json?` сейчас свободное. До первого реального write'а зафиксировать `TKnowledgeSourceMetadata` type + zod-схему и валидировать в сервисе перед записью. Чтобы не получить в бд JSON-помойку ('user-agent' / FF-флаги / случайный debug-dump).

**Где разместить тип:** Phase 1 PR4 закрыт без выделения `libs/knowledge/` — модуль живёт в `apps/api/src/modules/knowledge/`. Тип сейчас положить туда же (`apps/api/src/modules/knowledge/t-knowledge-source-metadata.ts`); при будущем выделении в `libs/knowledge/` (по триггеру второго потребителя — см. ADR-006 амендмент 2026-05-02) перенесётся вместе с остальным модулем.

### 16. `prisma-generator-nestjs-dto` — мигрировать / заменить

`npm audit` показывает 37 vulnerabilities (4 low / 26 moderate / 7 high), все транзитивно через `prisma-generator-nestjs-dto@1.1.4` → `@prisma/sdk@3.15.2` → `checkpoint-client@1.1.21` / `temp-write@4.0.0` / старый `uuid`. Это **dev-зависимость** (генератор запускается на `prisma generate`), в runtime не попадает. Но перед первым прод-деплоем варианты:

1. Форк генератора + обновление deps (работа на выходные).
2. Альтернативный генератор — проверить [`@prisma-nestjs-graphql`](https://github.com/unlight/prisma-nestjs-graphql) совместимость.
3. Генерировать DTO вручную из Prisma schema (опция если DTO-poverty минимальна).

### 17. Удалить `DevOnlyHeaderAuthGuard` + `X-User-Id` при вводе JWT

Добавлено в PR4-hardening: guard `libs/common/src/http/dev-only-header-auth.guard.ts` роняет endpoint'ы knowledge в `NODE_ENV=production` — защита от случайного деплоя с `X-User-Id` header-auth.

**При вводе JWT auth (отдельный PR):**
- убрать `@UseGuards(DevOnlyHeaderAuthGuard)` со всех controller'ов
- убрать `@UserContext()` декоратор / заменить на `@User()` из JWT guard'а
- удалить файлы `dev-only-header-auth.guard.ts`, `user-context.decorator.ts`, `headers.ts`
- убрать `TUserContext` anonymous-ветку или оставить только для public endpoints
- задокументировать миграцию в ADR-007 (JWT auth)

### 18. Orphan-записи `userId IS NULL` backfill при вводе JWT

В Phase 1 анонимные запросы создают записи с `userId = NULL`. После ввода JWT:
- либо одноразовый SQL-job: привязать orphan к service-account user'у
- либо DELETE всех `userId IS NULL` записей с предупреждением
- решение в миграции 2026-XX-XX_auth_migration, до применения — snapshot БД

### 19. `prisma:migrate:reset` consent-guard в документации

Скрипт в `package.json`:
```
"prisma:migrate:reset": "prisma migrate reset"
```

Prisma 7 требует `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1` для reset в AI-сессии. Без env-var CLI откажется (это правильная защита). Перед использованием в README добавить один параграф: «если скрипт завис/отказался — выставь env-var, данные будут снесены».

---

## Backlog идей для обсуждения

### A. Auto-generated SDK для фронта → npm

Когда будет 2–3 реальных эндпоинта (не только `/health`):

1. `@nestjs/swagger` уже экспортирует `/api/docs-json` — OpenAPI 3.x spec.
2. Скрипт `npm run sdk:gen` читает spec и генерирует типизированный TS-клиент в `libs/api-sdk/`. Кандидаты:
   - **`@hey-api/openapi-ts`** — современный, tree-shakable, zero runtime deps
   - **`orval`** — умеет генерить react-query / swr / axios / tRPC клиенты
   - **`openapi-typescript-codegen`** — классика, но менее активен
3. Публикация как `@slovo/api-sdk` в npm (приватный registry или scoped public) — фронтенд ставит через `npm i @slovo/api-sdk`.
4. CI: автогенерация + bump версии + `npm publish` на теге/релизе.

Плюсы: фронт всегда типизирован против реального бека, нет ручного дублирования DTO, изменение API сразу ломает фронт-билд (что хорошо). Минусы: один больше пакет в npm и CI-этап.

Решить на стадии: первая UI-фича, или когда появится отдельный фронт-репо.

### C. MCP-сервер Flowise — путь к extract и publish

См. ADR-008 + amendment 2026-04-30.

**Закрыто:**

- ✅ Полное покрытие — **66 tools** в `apps/mcp-flowise/` (commit `e0cd3e6`):
  - Document Stores 22 (CRUD + chunks + loader + vectorstore + components + generate_tool_desc)
  - Chatflows 6 (CRUD + by_apikey)
  - Nodes 2 (list/get для discovery 301 ноды)
  - Predictions 1 (с uploads/history/form)
  - Vector 1 (legacy chatflow upsert)
  - Credentials 5 / Variables 4 / Custom Tools 5 / Assistants 5
  - Composite 3 (chatflow_clone, docstore_clone, docstore_full_setup)
  - DX helpers 3 (introspect, smoke, docstore_search_by_name)
  - Misc 4 (ping, attachments_create, chatmessage abort/delete_all, upsert_history patch_delete)
- ✅ 100% unit-test coverage всех 66 tools (32 test suites, mock fetch + happy + error cases)
- ✅ `package.json` publish-ready (description, keywords, bin, main: dist/index.js, repository, MIT, prepublishOnly), `tsconfig.build.json` (declarations + source maps), `LICENSE`, build → `dist/`
- ✅ README с категориями + примеры для каждой группы tools
- ✅ **`libs/flowise-flowdata/`** — типизированный builder для chatflow flowData (10 typed factories + generic.ts с реальным `fromIntrospection` для покрытия 200+ нод через MCP `nodes_get`). Closed `chatflow_create` flowData utility пункт.

**Открытые задачи для production-grade pipeline:**

1. **CI smoke против реального Flowise dev-инстанса** — отдельный workflow в GitHub Actions:
   ```yaml
   name: mcp-flowise-smoke
   on: { schedule: [{ cron: '0 6 * * 1' }], workflow_dispatch: }  # weekly
   jobs:
     smoke:
       services: { flowise: { image: flowiseai/flowise:3.1.2, ports: [3130:3000] } }
       steps:
         - run: npm test -- apps/mcp-flowise
         - run: |
             # Прогон через MCP stdin/stdout: initialize + tools/list + flowise_smoke
             node --env-file=.env apps/mcp-flowise/dist/index.js < smoke-mcp-payload.json
   ```
   Поймает breaking changes при апгрейде Flowise (3.1 → 3.2 → 4.x).

2. **`FLOWISE_API_KEY` валидация в `libs/common/src/config/env.schema.ts`** ⚠️ **PRE-PR6 PREREQUISITE** (раньше было «решить в PR6» — поднято в priority после architect-review 2026-04-30). Сейчас валидируется только в `apps/mcp-flowise/src/config.ts`. PR6 (`apps/worker/catalog-refresh`) будет ходить в Flowise REST через `mcp-flowise` client — без env-валидации словим 401 при первом запуске. Сделать **до** мержа PR6: добавить `FLOWISE_API_KEY: z.string().min(1)` в `envSchema` (рядом с `FLOWISE_API_URL` который уже есть).

3. **MCP scope filter** (`MCP_FLOWISE_SCOPE=full|minimal`) — отложить пока. Триггер пересмотра — когда подключится 2-й параллельный MCP-сервер и суммарный `tools/list` контекст превысит ~20 KB.

4. **Streaming prediction** — skip. SSE не работает через MCP stdio — для streaming использовать прямой HTTP к Flowise. Зафиксировано в README (`prediction.ts:streaming` исключён из schema, всегда `false` в body).

5. **Catalog-refresh observability** — `apps/worker/src/modules/catalog-refresh/` сейчас логирует `elapsedMs` через NestJS Logger, но не идёт в Langfuse/prom-метрики. Когда подключится observability (отдельный tech-debt пункт):
   - `catalog_refresh_elapsed_ms` (histogram) — для p99 latency tracking.
   - `catalog_refresh_skipped_total{reason}` — counter с labels `lock-held` / `store-not-found`.
   - `catalog_refresh_failed_total` — counter.
   - **Alert**: `elapsedMs > LOCK_TTL_SEC * 1000 * 0.8` — приближение к истечению lock'а, потенциально cron tick'и пропускаются.

6. **Verify `replaceExisting=true` semantics через Flowise источник** — реальный recipe для lab journal: триггернуть `flowise_docstore_refresh` с `replaceExisting=true`, прибить Flowise через `docker stop` в середине, проверить `vector_store_metadata.totalChunks`. Если drop-then-insert и не транзакционно — окно с пустыми результатами для `/catalog/search` (несколько минут). Альтернатива: `replaceExisting=false` + отдельный cleanup job по `loaderId` + timestamp. Сейчас принято `replaceExisting=true` — закроем после первой prod-выкатки.

7. **Concurrent refresh test** — `service.refresh()` дважды одновременно через `Promise.all`. Lock SET NX должен корректно skip второй вызов. Сейчас тестируется sequential, не concurrent. Не критично, но добавит уверенности.

8. **Extract в `Pelmenya/flowise-client` + `Pelmenya/mcp-flowise` + `Pelmenya/flowise-flowdata` + npm/Smithery publish** — план готов в ADR-008 amendment. Два пакета (transport + domain), peerDeps как у `@nestjs/microservices` → `@nestjs/common`. Триггеры:
   - Появится 2-й внешний потребитель (другой проект Дмитрия / community ask на GitHub Issues).
   - Stabilization period (2 месяца без breaking changes в API tools).
   - Smithery официально откроется для submission и появится экосистема.

   Шаги: `git filter-repo` для каждого пакета → переименование namespace → flowise-flowdata публикуется первым (с build-step через tsup/tsc, нужен `dist/` для npm) → mcp-flowise публикуется вторым с peerDeps → `.github/workflows/{test,publish}.yml` → `npm publish --access public` или Smithery submit.

Решить: пункт 1 — после первой prod-выкатки slovo-runtime; **пункт 2 — pre-PR6 prerequisite (закрыто 2026-05-01 commit `8e7134b`)**; пункты 3-4 — реактивно; пункт 5 — после первой prod-выкатки worker'а; пункт 6 — после первого боевого refresh с большим каталогом; пункт 7 — при следующем рефакторинге catalog-refresh; пункт 8 — по триггерам.

### D. Авто-генерация DTO через декораторы / zod-first

Цель: убрать boilerplate с двойных декораторов `@IsString() @ApiProperty(...)` на полях DTO.

Варианты:

1. **`nestjs-zod`** — zod-схема → DTO с автоматическим Swagger + валидацией. Мы уже используем zod (для env), логичное расширение. Минус: `@nestjs/swagger` пока не полностью совместим с `nestjs-zod` (обходится через `patchNestjsSwagger`).

2. **`@nestjs/mapped-types`** — `PartialType`/`PickType`/`OmitType`/`IntersectionType` на базовых DTO. Уже доступно, не требует новых deps, уменьшает копипаст без замены декораторов.

3. **Кастомные декораторы** (`@Property()` который = `@ApiProperty() + @IsString()` в одном) — работает, но теряем type inference из схем.

4. **Продолжать как сейчас** (Prisma DTO-генератор + ручные DTO для request/response) — тоже нормально. `prisma-generator-nestjs-dto` уже автоматизирует DB-DTO.

Решить: когда появится 5–10 DTO вручную и копипаст станет заметен. Если выбираем zod-first — это влияет на подход к валидации request body.

## После PR7 — vision-catalog hardening

> Открытые follow-up'ы по итогам architect+security review коммита `d8ca373`
> (`/catalog/search/text` endpoint). Закрытые в коммитах `22fe5cc` (hardening),
> `f093a6f` (StorageModule.forFeature), `267a05a` (whitelist+single-flight+
> name-lookup) — здесь не повторяются.

### 21. Embedding/Vision budget cap + Langfuse alert ✅ **ЗАКРЫТО (PR9 budget commit)**

Реализовано в `apps/api/src/modules/budget/`:
- BudgetService с assertVisionBudget/assertEmbeddingBudget + record методы
- @Global() module — единая точка для cross-cutting LLM cost protection
- env: VISION_BUDGET_DAILY_USD ($5), EMBEDDING_BUDGET_DAILY_USD ($1)
- Counters в Redis с UTC date-key `slovo:budget:{vision|embedding}:YYYYMMDD`
- 503 ServiceUnavailable + payload с spent/budget/resets_at
- Live verify: $0.014 vision + $0.000001 embedding после dev-runs

**Что НЕ сделано (отложено):**
- Per-IPv6-subnet throttle (custom ThrottlerStorage) — следующая фаза до prod
- Langfuse alerts — требует running Langfuse, отдельный setup
- Per-user budget после auth-модуля — связано с #17

### 21-historical. Original задача (для исторического контекста)

После PR8 (`/catalog/search/image`) cost exposure вырос ×35:
- `/text` (embedding): $0.0000004/call — 30 req/min/IP × distributed IPv6 (2^64) = catastrophe but cents-level
- `/image` (Vision): **$0.005-0.007/call** — даже throttle 5/min/IP × 60min × 24h × $0.007 = **$50/день/IP**, distributed botnet → $50K-$500K/день

До prod-релиза **`/catalog/search/image`** (раньше чем text):

1. **Global daily $-budget cap** на Vision calls — Redis counter
   `slovo:vision:budget:daily` с TTL=86400. При превышении — return 503
   `quota_exceeded` для anonymous, allow для authenticated.
2. **Embedding budget cap** — аналогично через
   `slovo:embed:budget:<bucket>`, ниже priority потому что cost минимален.
3. Langfuse alert на `daily_vision_calls`, `daily_vision_cost_usd`,
   `daily_embedding_calls` через usage trace ingestion.
4. **Per-IPv6-subnet throttle** (по `/64` маске вместо whole IP) — IPv6
   /64 prefix = одно физическое подключение. Без этого distributed
   throttle bypass через ServerSide IPv6 rotation тривиален.
5. Когда появится auth-модуль (см. #17) — anonymous limit drop до 1/min
   на image, 5/min на text. Authenticated — больше с per-user budget.

Триггер: **до открытия `/catalog/search/image` наружу из dev-сети** —
сейчас blocker для prod. Image cost ×35 от text → защита нужна раньше.

### 22. `libs/redis/forFeature` — extract в paire с storage

Сейчас Redis client инстанцируется отдельно в `apps/api/catalog.module.ts`
и `apps/worker/catalog-refresh.module.ts` — конфигурация (host/port/password/
maxRetriesPerRequest/connectTimeout/commandTimeout) копируется. Drift риск:
один поправит password handling, другой нет.

Triggered когда появится **3-й** Redis-consumer (knowledge cache, LLM session
storage, rate-limit shared store). Pattern по аналогии с `StorageModule.forFeature`:

```ts
RedisModule.forFeature({ namespace: 'catalog' })
  // → провайдит Redis client с keyPrefix='catalog:' для namespace isolation
```

Размер extract: ~50 LOC новый module, ~25 LOC сокращение в каждом потребителе.

Триггер: PR с 3-м потребителем Redis.

### 23. METADATA_WHITELIST sync trigger

`apps/api/src/modules/catalog/search/text.service.ts:METADATA_WHITELIST` —
explicit whitelist полей feeder-метаданных которые отдаются клиенту. При
расширении feeder'а (CRM aquaphor добавит новое поле в `latest.json`):

- **DO**: проверить что новое поле — public-safe, добавить в whitelist
  (если нужно отображать в UI), обновить тесты.
- **DON'T**: не пропускать через `metadata: doc.metadata` без whitelist —
  вернётся info-leak risk.

Pattern для check'а в pre-PR review: при изменении `crm-aqua-kinetics-back/.../
catalog-snapshot/build-payload.ts` — обновить METADATA_WHITELIST синхронно.

Триггер: каждый PR в feeder который меняет shape `TBulkIngestItem.attributes`
или добавляет новые top-level поля в `latest.json` items.

### 24. Vision-catalog: Prisma `CatalogItem` модель (опционально)

Сейчас Document Store metadata + Flowise чанки — единственное хранилище
каталога (Level 1 архитектура из lab journal day 2). Когда понадобится:

- **soft-delete tracking** через `lastSeenAt < syncStart` (catalog-refresh
  worker не делает GC сейчас).
- **presigned URL caching на стороне БД** (вместо Redis 50м TTL — постоянная
  таблица `catalog_image_keys` с rotation policy).
- **per-tenant store mapping** (multi-tenant TODO).

Триггер: каталог достигнет 1000+ items + появятся multiple feeder'ы (1С + ручной
import) или нужна будет ad-hoc analytics через SQL.

Срез плана — `docs/features/vision-catalog-search.md` секция «Phase 2 Prisma
layer» (PR9 в roadmap).

### 25. catalog-refresh worker — testcontainers integration test

PR6.5 unit-тесты (26 spec'ов) полностью мокают Flowise/Postgres/S3. Live
validation сделана через gitignored `experiments/run-orchestrate.mjs` —
не воспроизводится в CI. До прод-релиза worker'а — добавить
`apps/worker/test/catalog-refresh.e2e-spec.ts` через testcontainers:

- Postgres + pgvector контейнер
- LocalStack S3 (или `s3rver`) для MinIO эмуляции
- Flowise stub — простой Express-server возвращающий канонические
  responses на эндпоинты worker (list stores, delete loader, upsert)

Покроет: TRUNCATE против реального pgvector с HNSW-индексом, S3 stream'инг
(включая size cap), zod validation на реальных JSON, end-to-end through
Flowise stub.

Триггер: до первого prod-выкатки worker'а / при выходе на 1000+ items
каталога.

### 26. catalog-refresh — multi-vectorstore support (Pinecone/Chroma branching)

`extractVectorStoreTableName` сейчас фиксирует `vsName === 'postgres'`.
ADR-002 запрещает Pinecone/Qdrant, но если когда-то появится 2-й
Document Store с другим backend (например Chroma локально для embeddings
на Ollama) — нужна strategy pattern, а не if/else в одной функции.

Триггер: при появлении 2-го vectorstore backend.

### 27. catalog-refresh — Flowise vector table coupling ✅ **ЗАКРЫТО (PR9.5)**

PR6.5 делал прямой TRUNCATE через `prisma.$executeRawUnsafe('TRUNCATE
"catalog_chunks"')` — hidden coupling с Flowise schema.

PR9.5 убрал TRUNCATE: Flowise `postgresRecordManager` с
`cleanup=incremental` сам управляет lifecycle chunks. Slovo больше не
знает о таблице `catalog_chunks` — coupling ушёл на сторону Flowise
(где ему и место). `DatabaseModule` удалён из `CatalogRefreshModule`.

`ALLOWED_VECTOR_TABLES` whitelist оставлен в constants как defence-in-depth
(на случай если admin поменяет `vectorStoreConfig.config.tableName` через
Flowise UI — refresh fail-fast'ит до того как послать что-либо в БД).

### 28. catalog-refresh — multi-replica TRUNCATE retry/backoff ✅ **ЗАКРЫТО (PR9.5)**

TRUNCATE удалён вместе с PR9.5 RecordManager refactor. Race condition
больше не возможен — Flowise делает per-loader DELETE через RecordManager
(idempotent, не lock'ит таблицу).

При появлении 2+ workers (k8s replicas) актуальной проблемой остаётся
Redis lock fairness — два cron'а одновременно дёрнут SET NX, один
выиграет, второй вернёт `lock-held` (это OK, refresh идемпотентен).

### 29. FlowiseNameResolver helper — extract single-flight name lookup ⚠️ **ТРИГГЕР СРАБОТАЛ (2 мая 2026)**

`TextSearchService.resolveStoreId/lookupStoreId` (PR7 follow-up C),
`ImageSearchService.resolveChatflowId/lookupChatflowId` (PR8) и теперь
**`VisionAugmenterService.resolveChatflowId/lookupChatflowId`** (Phase 2,
коммит `69dd5d2`) — три почти точные копии single-flight + retry-on-failure
pattern с разницей только в endpoint и nameField. **Третий потребитель
сработал триггер extract**.

Pattern:
```ts
const resolver = new FlowiseNameResolver(flowise, {
    listEndpoint: ENDPOINTS.chatflows,
    name: VISION_CHATFLOW_NAME,
    label: 'vision chatflow',
    cacheTtlMs: 5 * 60_000, // защита от stale id после Flowise recovery
});
const id = await resolver.resolve(); // lazy, single-flight, retry, TTL
```

Размер extract: ~50 LOC новый helper в `libs/flowise-client/`, ~30 LOC
сокращение в каждом потребителе. Бонус: добавить TTL на cached promise
(5-10 минут) — текущая мемоизация навсегда означает stale id если chatflow
пересоздан с новым id.

**Когда делать:** в составе следующего PR в зону `libs/flowise-client/` или
любой из 3 потребителей. Не блокирует прод-релиз — текущие копии работают,
но drift неизбежен (например, сейчас augmenter имеет специфичный
`chatflowMissingErrorLogged` flag для anti-spam — должен мигрировать в helper).

### 31. Multi-image Vision — prompt v2 ✅ **ЗАКРЫТО (1 мая 2026)**

PR9 e2e обнаружил: prompt v1 не справлялся с multi-image input — возвращал
not-JSON-object → 502 BadGateway. Vision интерпретировал «несколько фото»
как «несколько товаров → массив описаний».

**Решение (1 мая 2026):** обновлён `systemMessagePrompt` в Flowise chatflow
`vision-catalog-describer-v1` (id `991f9b70-fdae-...`) через `flowise_chatflow_update`.
Скрипт реализации — `experiments/update-vision-prompt-v2.mjs` (gitignored,
рецепт повторим). Ключевые добавления:

1. Явное «На вход — одно или несколько (до 5) изображений ОДНОГО товара»
2. «Если фото несколько — это разные ракурсы того же объекта»
3. Strict «**Верни ровно ОДИН валидный JSON-объект** (не массив, не строку,
   не null)»
4. Правило #4 «При нескольких фото — объедини информацию со всех ракурсов
   в ОДИН описательный объект»
5. Правило #9 «JSON должен быть валидный: ровно один объект (typeof ===
   'object', не Array.isArray, не null)»

Live verify (1 мая 2026, retest через `experiments/test-universal-search.mjs`):
- TEST 4b: 2 копии reverse-osmosis.jpg → **200 OK** в 6.1s, ОДИН combined
  description (не массив).
- TEST 4: filter+softener (разные товары на фото) → 400 is_relevant=false
  семантически корректно (Vision не нашёл водоочистки на конкретных кадрах).

**Историческая запись:** Phase 0 prompt был оптимизирован под single-image,
multi-image поддержка появилась только когда API contract стал универсальным.

**Tech-debt residual:**
- A/B test on production data — когда появятся реальные multi-image
  запросы от клиентов, проверить metric (relevance / cost / latency).
- При расширении prompt'а с features/condition/etc — мигрировать на zod
  schema parsing (см. tech-debt #30).

### 30. Vision response — zod schema когда prompt расширится

`ImageSearchService.parseVisionResponse` сейчас manual narrowing на 5 полей
(is_relevant, description_ru, category, brand, model_hint, confidence). При
расширении vision-describer prompt (Phase 2 план — features, condition,
brand_family, image_quality_score) ручной парсинг станет 200+ строк.

Trigger threshold: **7+ полей** в `TVisionRawOutput` или nested objects.
Тогда заменить ручные `typeof === 'string'` checks на zod-схему.

```ts
const visionSchema = z.object({
    is_relevant: z.boolean(),
    category: z.string().nullable().optional(),
    // ... все поля типизированы один раз
});
```

Триггер: при добавлении 2+ новых полей в Vision prompt.

### 32. catalog-refresh — Redis loader-mapping recovery

**Контекст (PR9.5):** state ingest pipeline распределён по трём хранилищам: `catalog_chunks` (Flowise pgvector), `catalog_record_manager` (Flowise PR9.5 RecordManager), Redis HASH `slovo:catalog:loaders` (slovo-side externalId → docId).

**Проблема:** если Redis HASH потеряется (FLUSHDB / replica-fail / ручная зачистка / `persistLoaderMapping` упал на длинном refresh), следующий cron tick:

1. Загрузит пустой mapping (`{}`)
2. Для каждого item upsert'нёт **без** stored docId
3. Flowise создаст **новые** loader entries (новые docId) на тот же `externalId`
4. RecordManager защищает chunks через `sourceIdKey=externalId`, но **loader entries** в `documentstore.loaders` JSON column раздуются дубликатами
5. Все 155 items пройдут полный re-embed (~$0.0038/refresh × 6 = ~$0.023/day = ~57 ₽/мес — регрессия PR9.5)

**Решение (когда нужно):** при detection `loaderMapping is empty` AND `Flowise store.loaders.length > 0`, автоматически восстановить mapping из Flowise (`GET /document-store/<id>` → каждый loader содержит `metadata.externalId`):

```ts
if (Object.keys(loaderMapping).length === 0 && store.loaders.length > 0) {
    const reconciled = await this.reconcileMappingFromFlowise(store);
    if (Object.keys(reconciled).length > 0) {
        await this.redis.hset(CATALOG_LOADERS_REDIS_KEY, reconciled);
        loaderMapping = reconciled;
    }
}
```

**Security caveat при реализации:** `loader.metadata.externalId` хоть изначально и пишется slovo через `buildItemMetadata(item)`, но при reconcile значение приходит из Flowise pgvector — если кто-то скомпрометировал Flowise напрямую (SQL injection / SSRF в Flowise routes), `externalId` может стать любой строкой. Перед записью в Redis применить тот же zod-guard что и для `docId` (`min(1).max(256).regex(/^[a-zA-Z0-9_-]+$/)`).

Триггер: после первого инцидента с Redis data-loss / при появлении observability на cost-spike (#33).

### 33. catalog-refresh — cost-spike monitoring

**Контекст:** PR9.5 экономит ~95% на embeddings через RecordManager skip. Если Flowise upgrade сломает hash-comparison (RecordManager schema migration / version bump в LangChain), сервис тихо вернётся к full re-embed-all. `runScheduled` логирует counters, но **нет алерта**.

**Решение:**

1. После 2+ refresh'ей с populated mapping — добавить warn-log если `itemsSkipped / itemsTotal < 0.5`. На стабильном каталоге это означает либо: (a) feeder выкатил массовое обновление контента (legitimate), (b) RecordManager перестал работать (regression).
2. Long-term — Langfuse trace на `slovo.catalog-refresh.skip-rate` (gauge metric) с alert если > 7 дней <50%.

```ts
const skipRate = result.itemsSkipped / result.itemsTotal;
if (mappingWasPopulated && skipRate < 0.5) {
    this.logger.warn(
        `catalog-refresh skip-rate ${(skipRate * 100).toFixed(0)}% — ` +
        `проверить RecordManager (regression?) или massive feeder update`,
    );
}
```

Триггер: до prod-релиза worker'а / при появлении Langfuse observability slovo runtime.

### 34. Anthropic prompt caching — оценить montevive/autocache как альтернативу гибриду

**Контекст:** Flowise 3.1.2 ChatAnthropic node (version=8) не поддерживает `cache_control: { type: "ephemeral" }`. Source-scan подтвердил: в `flowise-components/dist/nodes/chatmodels/ChatAnthropic/ChatAnthropic.js` нет ни одного упоминания cache_control/cacheControl/ephemeral. Upstream [#4289](https://github.com/FlowiseAI/Flowise/issues/4289) и [#4634](https://github.com/FlowiseAI/Flowise/issues/4634) — open без движения.

**Текущий план (knowledge-base.md):** гибрид. Retrieval через `flowise_docstore_query`, генерация через `libs/llm/` (прямой Anthropic SDK с native `cache_control`). Стоимость: ~200-400 LOC в `libs/llm` + переключение каждого LLM-вызова на свой fallback.

**Альтернатива — transparent proxy:** [montevive/autocache](https://github.com/montevive/autocache)

- Go-сервис, MIT, ~70 ⭐ (Apr 2026), активный (last commit 20 Apr 2026)
- Встаёт между Flowise и `api.anthropic.com`, на лету инжектит `cache_control` блоки в проходящие запросы
- В README заявлена поддержка Flowise/n8n/Make.com/LangChain/LlamaIndex как «no code changes required»
- Стоимость интеграции: одна переменная окружения `ANTHROPIC_BASE_URL=http://autocache:8080` в `docker-compose.infra.yml` для Flowise + добавить контейнер в compose

**Что нужно проверить перед commitment:**

1. Реальное cache hit ratio на наших промптах (vision-describer multi-image system prompt + user query — варьируется ли префикс достаточно стабильно для cache hit)
2. Latency overhead proxy hop (~10-30ms ожидаем — приемлемо)
3. Мониторинг: как autocache раскрывает stat кешей для Langfuse
4. Совместимость с streaming responses Flowise → Anthropic
5. Безопасность: API ключ Anthropic будет проходить через autocache → проверить что secrets не логируются

**Trade-off:**
- Гибрид (libs/llm): полный контроль, явно видно где caching применяется, но требует переписать каждый call site. Cache работает **только** в `libs/llm` вызовах, не в Flowise chatflows.
- Autocache proxy: zero code changes, caching работает **на всём** что идёт через Flowise (включая будущие chatflows с Sonnet/Haiku). Но добавляет 5-й контейнер в `docker-compose.infra.yml` + новая критичная зависимость.

Триггер: когда vision-describer / Q&A флоу выйдут в прод и cost prompt-кэшированию реально оправдает оценку. Тогда — два дня A/B на staging (autocache off vs on), решение по cache hit %.

### 35. SHA256-кэш повторных image-запросов (Vision dedup) — pre-launch blocker

**Контекст:** prostor-app — открытая клиентская платформа. Естественный паттерн клиента: сфотографировал свой картридж → искал → не нашёл / нашёл → через минуту пробует **тот же** запрос снова (или с минимальным crop'ом). Сейчас каждый image-запрос идёт в Anthropic Vision ($0.005-0.007), даже на байт-в-байт идентичный файл.

**Решение:**

1. На границе `apps/api/src/modules/catalog/search/image.service.ts` (или universal `search.service.ts`) посчитать `sha256(image.buffer)` на upload'e.
2. До отправки в Vision проверить Redis: `GET slovo:vision:cache:<sha256>`.
3. Hit → вернуть cached `vision_description` (skip Vision call). Miss → Vision → `SETEX slovo:vision:cache:<sha256> 86400 <description>`.
4. TTL 24ч — баланс между частотой повторов и cache pollution. После недели мониторить hit-rate, скорректировать.

**Ожидаемая экономия:**
- При 30% повторов на одном клиенте + 20% повторов между клиентами (популярные модели Аквафор) = 30-50% Vision calls = 30-50% от Vision-cost.
- На активном пилоте (3 600 ₽/мес из exec-summary): экономия ~1 200-1 800 ₽/мес.

**Стоимость реализации:** ~50 LOC + 5-10 spec'ов. Половина дня вечером.

**Edge cases:**
- Cache key — sha256 raw bytes; разные форматы (JPG quality / EXIF rotation) дадут разные хеши, **это правильно** — Vision на эти варианты может ответить по-разному.
- На multi-image запрос — `sha256(concat(sorted(image_hashes)))` или просто пропустить (multi-image редкий).
- Cache poisoning: если в cache попал плохой response (например, Vision вернул not-relevant ошибочно), TTL 24ч сам очистит. Manual flush через `redis-cli DEL slovo:vision:cache:*` если нужно срочно.

**Триггер:** до публичного запуска prostor-app (см. pre-launch blockers в начале файла).

### 36. Budget-cap exhaustion — alert-уведомление админу

**Контекст (расширение #21):** `apps/api/src/modules/budget/` уже возвращает 503 при достижении $5/день Vision или $1/день Embedding. Но **никто не узнает** о превышении пока клиент не пожалуется. На открытой клиентской платформе это значит «3 часа сервис не работает, пока админ не зашёл в логи».

**Решение:**

1. В `BudgetService.assertVisionBudget()` / `assertEmbeddingBudget()` — детектить **первое** превышение в день (через Redis флаг `slovo:budget:alerted:<vision|embedding>:YYYYMMDD` с TTL 25ч).
2. На первое превышение → fire-and-forget POST в Telegram Bot API (или `nodemailer`) с message: «Vision budget exhausted on YYYY-MM-DD at HH:MM. Spent: $X. Recent traffic: ...».
3. Без Langfuse — это отдельная зависимость которая не оправдана для одного алерта.

**Альтернатива (когда Langfuse будет в prod):** trace на `slovo.budget.exhausted` event + alert rule в Langfuse UI.

**Стоимость:** ~30 LOC + env vars `TELEGRAM_BOT_TOKEN` + `TELEGRAM_ADMIN_CHAT_ID` (или SMTP creds). Час работы.

**Триггер:** до публичного запуска prostor-app.

### 37. Webhook-trigger для catalog-refresh — заменить пассивный cron активным push'ом

**Контекст:** ADR-007 amendment 2026-04-30 уже предусмотрел этот переход:
> *Если cron-latency 4ч начнёт мешать UX → перейти на webhook-trigger (`POST /catalog/sync-now`) поверх того же файлового контракта (slovo читает по триггеру + по cron). ADR не отменяется.*

С запуском prostor-app задержка 4 часа становится ощутимой: товар изменён в CRM в 12:30 → попадёт в search только в 16:00. Для клиентской платформы это плохо (клиент ищет картридж по фото — Vision верно описала «Аквафор B520 PRO», а товар уже снят с продажи в CRM, но slovo об этом не знает).

**Архитектура:**

1. **CRM-aqua-kinetics-back** после write `latest.json` в MinIO (или после `cache-reset` события / на старте приложения) → POST в slovo `/catalog/sync-now` с HMAC-SHA256 подписью body+timestamp.
2. **slovo (`apps/api`)** — новый controller `CatalogWebhookController`:
   - Валидация HMAC через shared secret `CATALOG_WEBHOOK_SECRET` (env, обе стороны)
   - Replay protection: timestamp в payload, отбрасываем если > 60 сек старше now
   - Публикует RabbitMQ message в queue `catalog.refresh.requested`
   - Возвращает 202 Accepted за ~50ms
3. **slovo (`apps/worker`)** — `CatalogRefreshConsumer`:
   - Подписан на queue `catalog.refresh.requested`
   - Триггерит существующий `CatalogRefreshService.refresh()` (Redis-lock защита уже есть)
   - При `lock-held` (другой refresh идёт) → ставит флаг `slovo:catalog:refresh:pending=1`
   - По завершении текущего refresh — проверяет флаг → если есть, запускает follow-up (один). Естественный coalescing для bulk-update сценариев.
4. **Cron остаётся как fallback** — `@Cron(CATALOG_REFRESH_CRON)` не выкидываем. Если webhook упал / CRM забыл / network — через 4ч всё равно sync. Belt-and-suspenders.
5. **`OnApplicationBootstrap` hook** — refresh при старте slovo-app. Сейчас после restart следующий cron-tick через 4ч; с bootstrap-trigger каталог свежий через минуту.

**Что нужно для CRM-стороны:**
- Endpoint вызывается **после успешной записи** в MinIO (не до — иначе slovo прочитает старый файл).
- Retry с backoff на не-200 (3 попытки, exponential): сетевые блипы не должны рушить sync.
- Логирование каждого webhook-вызова для аудита.

**Что нужно для slovo-стороны:**
- `apps/api/src/modules/catalog/webhook/` — controller + DTO + HMAC-validator
- 5-10 spec'ов: HMAC valid → 202, HMAC invalid → 401, stale timestamp → 401, valid → message published, RMQ down → 503, replay attempt → 401
- `apps/worker/src/modules/catalog-refresh/` — consumer module + pending-flag logic + follow-up test
- env vars `CATALOG_WEBHOOK_SECRET` (shared) + `RMQ_*` уже стоят
- ADR-007 amendment 2026-05-XX (или later) с фиксацией реализации

**Стоимость:** 1-2 вечера на slovo (~300-400 LOC + ~150 LOC тестов) + 1 PR на стороне CRM (~50 LOC + retry-логика). Требует **координации с CRM-командой** — это не solo-task.

**Триггер:** **в составе Phase 2** (publish prostor-app). Желательно вместе с pre-launch blockers (A-D), но не обязательно — webhook это enhancement, не security.

**Risk если не сделать:** клиенты видят неактуальные данные (изменения в CRM до 4ч) — UX-проблема, не безопасность. Можно жить с cron'ом первую неделю в prod, потом выкатить webhook когда соберём метрики реальной частоты обновлений каталога.

### 38. Vision augmentation на ingest — обогащение `contentForEmbedding` визуальным описанием

**Контекст (ревизия 2026-05-02):** текущий `/catalog/search/image` pipeline:
```
Клиент шлёт фото → Vision text → embedding → match against contentForEmbedding (CRM-описание)
```
**Проблема:** `contentForEmbedding` описывает товар **функционально** (характеристики, услуги, картриджи), не **визуально** (форма, цвет, корпус). Vision клиентского фото возвращает «синий цилиндрический корпус с двумя картриджами» — этих слов нет в CRM-описании. Embeddings в разных частях семантического пространства.

**Решение:** на catalog-refresh для каждого товара с `imageUrls` дёргаем Claude Vision → получаем визуальное описание → дописываем в `contentForEmbedding` как новую секцию.

```
contentForEmbedding после augmentation:
  Название: ...
  Описание: ...
  ...
  [существующие секции от feeder'а]
  ...
  Визуальный вид: синий цилиндрический корпус, под мойку, две картриджные чаши с прозрачными колбами
```

**Cost (актуальные данные 2026-05-02 на 155-item каталоге):**
- 155 items × $0.007 multi-image Vision (до 5 фото в одном call) = **$1.09 ≈ 87 ₽** один раз для всего каталога
- На refresh — только товары с изменёнными фото (см. #39 hash-cache) → копейки/мес
- Реалистичный refresh: 5-10 товаров с changed photo/мес × $0.007 = $0.07/мес ≈ 5,6 ₽/мес

**Где реализовать:**
- В `apps/worker/catalog-refresh.service.ts:upsertItem` — перед сборкой `contentForEmbedding` дёрнуть Vision (если есть imageUrls) → обогатить text перед передачей в Flowise upsert
- Альтернатива: в feeder `crm-aqua-kinetics-back` на сборке `latest.json` — но тогда feeder нужен Anthropic SDK и cost-cap. **Лучше в slovo** — единый бюджет-cap, единая observability.

**Важно: услуги/компоненты УЖЕ агрегируются feeder'ом ✅** (проверено 2026-05-02 на live payload — все relatedServices/Components присутствуют в `contentForEmbedding`). Augmentation добавляет **только** визуальный слой, не дублирует услуги.

**Триггер:** Phase 2 enhancement, после первой недели real traffic'а — замерить baseline image-search точность, потом A/B на augmented vs non-augmented chunks.

### 39. Image-hash cache для Vision augmentation (RecordManager-style)

**Контекст:** при включении #38 — каждый catalog-refresh (cron 4ч + webhook) будет дёргать Vision на каждом товаре, даже если фото не менялись. Это $1/refresh × 6 cron/день = $6/день = ~14 400 ₽/мес впустую.

**Решение:** аналог нашего PR9.5 RecordManager pattern, но для image content:
- Redis HASH `slovo:catalog:vision-augment:<externalId>` → `{ imageHash, visualDescription }`
- `imageHash = sha256(concat(sorted(imageUrls.map(getImageBytes))))` — стабильный hash от content всех фото
- На refresh: вычислить новый imageHash → если совпал → reuse visualDescription из mapping (skip Vision call); не совпал → re-Vision → update mapping
- REMOVED-sweep как в PR9.5: товар удалён → HDEL запись

**Cost после оптимизации:**
- Стабильный каталог (фото не меняются): ~5-10 товаров с new photo/мес × $0.007 = $0.07/мес ≈ 5,6 ₽/мес
- Reload всего каталога (например, ребрендинг — все фото поменяли): worst case 155 × $0.007 = $1.09 = 87 ₽ один раз

**Стоимость реализации:** ~80 LOC (helper `computeImageHash` + Redis HASH ops + integration в `upsertItem`) + 8-10 spec'ов (hit/miss/REMOVED-sweep/corrupt entry).

**Зависит от:** #38 (без augmentation cache не нужен).

### 40. Hybrid search ts_vector + embeddings — отложить

**Контекст:** ts_vector PostgreSQL работает на точные совпадения (артикулы, бренды, фиксированные категории) бесплатно и быстро (~10-50ms на 155 items). Embeddings ловят семантику и описательные запросы. Production RAG-pattern — RRF (Reciprocal Rank Fusion) или взвешенный ансамбль.

**Зачем теоретически:**
- Запрос с артикулом «B520 PRO» — ts_vector точное совпадение, не нужно embedding round-trip ($0)
- Семантический запрос «фильтр от ржавой воды» — embeddings найдут обезжелезиватель

**Зачем не делаем сейчас:**
- При 155 items + ~$0.0000004/text-search = микро-копейки. ts_vector не даст экономии.
- ~150-200 LOC + миграция Prisma (GIN index на `to_tsvector`) + RRF логика на slovo стороне → сложность не оправдана для малого каталога.
- Без real query log за неделю в prod не знаем какая доля запросов «точная» (ts_vector хватит) vs «семантическая» (нужны embeddings).

**Триггер:** одно из двух:
1. Каталог вырастет ×10+ (1500+ items) И запросов станет 1000+/день → экономия на ts_vector становится заметной
2. Real query log покажет что embeddings промахивают на запросах с артикулами/брендами (точные совпадения), что критично для UX

**Подход когда пойдёт в работу:**
- Prisma migration: `ALTER TABLE catalog_chunks ADD COLUMN content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('russian', page_content)) STORED; CREATE INDEX catalog_chunks_tsv_idx ON catalog_chunks USING GIN (content_tsv);`
- В `text.service.ts` параллельно: text query → embedding pgvector search + ts_vector ранжирование → RRF fusion top-K
- A/B test на real query log первой недели

**Альтернатива:** trigram similarity (`pg_trgm` extension) для fuzzy match на артикулы. Дешевле ts_vector, ловит опечатки.

### 41. Vision-augment recovery plan — после Redis FLUSHDB / data-loss

**Контекст:** state ingest pipeline теперь распределён по 4 хранилищам:
- `catalog_chunks` (Flowise pgvector)
- `catalog_record_manager` (Flowise PR9.5)
- `slovo:catalog:loaders` Redis HASH (PR9.5)
- `slovo:catalog:vision-augment` Redis HASH (Phase 2, #70+#71)

#32 описывает recovery для loaders. Для **vision-augment recovery плана нет** — а это `$0.40 регрессия один раз` (на текущем 155-item каталоге) или `$4 / 1500-item / $40 / 15K-item` при росте.

**Сценарий риска:** Redis FLUSHDB / replica-fail / persist failure → augment-mapping пуст → next refresh re-Vision'ит все 155 items. На текущем масштабе $0.40 — не критично, при росте до 15K items = $40/инцидент.

**Решение (когда нужно):** при detection пустого vision-augment mapping AND non-empty `catalog_chunks` → попытаться восстановить description из существующих chunks. Augmented `pageContent` содержит секцию `Визуальный вид: ...` — парсим её regex'ом, восстанавливаем mapping без Vision call:

```ts
async reconcileFromChunks(): Promise<number> {
    const chunks = await this.flowise.queryAllChunks(storeId);
    const reconciled: Record<string, TAugmentMappingEntry> = {};
    for (const chunk of chunks) {
        const match = chunk.pageContent.match(/Визуальный вид: ([^\n]+)/);
        if (!match) continue;
        const externalId = chunk.metadata?.externalId;
        if (!externalId) continue;
        // imageHash recompute из текущих картинок (тот же хеш-функция)
        const imageBytes = await this.downloadAllForExternalId(externalId);
        const imageHash = computeImageHash(imageBytes);
        reconciled[externalId] = {
            imageHash,
            visualDescription: match[1].trim(),
            modelVersion: VISION_AUGMENT_MODEL_VERSION,
        };
    }
    return await this.redis.hset(VISION_AUGMENT_REDIS_KEY, reconciled);
}
```

**Security caveat:** при reconcile из chunks `externalId` валидируется через regex `[a-zA-Z0-9_-]+` (тот же что для docId в #66). Если в chunks попало мусорное значение (Flowise compromised) — не пишем в Redis.

**Триггер:** после первого инцидента Redis data-loss / при росте каталога ×10 (когда $40/инцидент станет заметным).

**Альтернатива:** `pg_dump` Redis (через AOF / RDB снапшоты) — стандартный disaster recovery. Без рекомпиляции мапы.

---

## До первого prod-деплоя миграций

### 20. `pg_dump` перед `prisma migrate deploy`

Поскольку Prisma миграции forward-only и `migrate resolve --rolled-back` не возвращает данные, единственный надёжный rollback в prod — восстановление из backup'а. В CI/CD перед каждым `migrate deploy`:

1. `pg_dump --format=custom --file=/backups/pre-migrate-${TIMESTAMP}.dump ${DATABASE_URL}` — снимок БД до миграции.
2. `npx prisma migrate deploy` — применяем миграции.
3. При неудаче healthcheck/smoke-тестов после деплоя: `pg_restore --clean --if-exists --dbname=${DATABASE_URL} /backups/pre-migrate-${TIMESTAMP}.dump`.

Ротация бэкапов: держать 7 последних (или 30 дней), старше — удалять (S3 lifecycle или cron).

Альтернатива без pg_dump — managed Postgres с point-in-time recovery (AWS RDS, DigitalOcean managed PG). Но даже так явный snapshot перед миграцией — дешёвая страховка.

---

## Workflow

- При добавлении новой зоны технического долга — писать сюда + синхронизировать с `CLAUDE.md` если нужно.
- При закрытии пункта — удалять его (или переносить в changelog ADR).
- Перед PR в соответствующую зону — открывать этот файл и сверяться.
