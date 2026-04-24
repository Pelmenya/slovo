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

### B. Авто-генерация DTO через декораторы / zod-first

Цель: убрать boilerplate с двойных декораторов `@IsString() @ApiProperty(...)` на полях DTO.

Варианты:

1. **`nestjs-zod`** — zod-схема → DTO с автоматическим Swagger + валидацией. Мы уже используем zod (для env), логичное расширение. Минус: `@nestjs/swagger` пока не полностью совместим с `nestjs-zod` (обходится через `patchNestjsSwagger`).

2. **`@nestjs/mapped-types`** — `PartialType`/`PickType`/`OmitType`/`IntersectionType` на базовых DTO. Уже доступно, не требует новых deps, уменьшает копипаст без замены декораторов.

3. **Кастомные декораторы** (`@Property()` который = `@ApiProperty() + @IsString()` в одном) — работает, но теряем type inference из схем.

4. **Продолжать как сейчас** (Prisma DTO-генератор + ручные DTO для request/response) — тоже нормально. `prisma-generator-nestjs-dto` уже автоматизирует DB-DTO.

Решить: когда появится 5–10 DTO вручную и копипаст станет заметен. Если выбираем zod-first — это влияет на подход к валидации request body.

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
