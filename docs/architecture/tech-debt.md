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

### 2. Pino-logger `redact`

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

### 12. `pg_dump` перед `prisma migrate deploy`

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
