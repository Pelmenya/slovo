# Технический долг

> Список hardening-задач, отложенных осознанно. Закрываем к моменту соответствующей вехи.
> Чек-лист на каждый PR, затрагивающий эти зоны — свериться; при закрытии задачи — удалить пункт.

Обновлено: 2026-04-22 (после первого автоматического ревью окружения через агентов в `.claude/agents/`).

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

Поле `metadata Json?` сейчас свободное. До первого реального write'а зафиксировать `TKnowledgeSourceMetadata` type + zod-схему в `libs/knowledge/` (появится в Phase 1 PR4) и валидировать в сервисе перед записью. Чтобы не получить в бд JSON-помойку ('user-agent' / FF-флаги / случайный debug-dump).

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

### 21. Embedding/Vision budget cap + Langfuse alert ⚠️ **PR8 RAISED PRIORITY**

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

### 27. catalog-refresh — Flowise vector table coupling

Worker делает прямой TRUNCATE Flowise-managed таблицы `catalog_chunks`
через `prisma.$executeRawUnsafe` (PR6.5). Это hidden coupling: slovo
зависит от Flowise table schema (имя, public schema). При апгрейде
Flowise (3.1 → 3.2 → 4.x) проверить:

- Имя таблицы: всё ещё контролируется через `vectorStoreConfig.config.tableName`.
- Schema: всё ещё `public` или Flowise начнёт создавать в своей.
- Колонки: TRUNCATE schema-agnostic, но если Flowise добавит обязательные
  FK — сломается без CASCADE.

Workaround при breaking change: либо вернуться на Flowise refresh с
RecordManager (требует доп компонент), либо patch Flowise S3 File Loader
для JSONLoader (вариант B из ADR-007 amendment, отложен).

Триггер: апгрейд Flowise major-версии.

### 28. catalog-refresh — multi-replica TRUNCATE retry/backoff

При появлении 2+ workers (k8s replicas) есть race: один worker делает
TRUNCATE, второй параллельно upsert'ит — `ERROR: cannot TRUNCATE because
it is being used by active queries`. Сейчас защищено Redis lock (только
один worker делает refresh за раз), но при разделении responsibilities
(refresh worker отдельно от upsert worker) гонка может вернуться.

Workaround: short retry с backoff (3 попытки × 1s) вокруг TRUNCATE.

Триггер: переход на k8s deployment с replicas > 1.

### 29. FlowiseNameResolver helper — extract single-flight name lookup

`TextSearchService.resolveStoreId/lookupStoreId` (PR7 follow-up C) и
`ImageSearchService.resolveChatflowId/lookupChatflowId` (PR8) — почти
точные копии single-flight + retry-on-failure pattern с разницей только
в endpoint и nameField. Третий (Phase 2: VisionDescriberService с per-tenant
chatflows) сделает 3 копии — кандидат на extraction в reusable helper.

Pattern:
```ts
const resolver = new FlowiseNameResolver(flowise, {
    listEndpoint: ENDPOINTS.chatflows,
    name: VISION_CHATFLOW_NAME,
    label: 'vision chatflow',
});
const id = await resolver.resolve(); // lazy, single-flight, retry
```

Размер extract: ~40 LOC новый helper в `libs/flowise-client/`, ~30 LOC
сокращение в каждом потребителе.

Триггер: при появлении 3-го name-lookup потребителя.

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
