# ADR-005: Prisma + raw queries для pgvector

## Статус
✅ Принято — 2026-04-22

## Контекст

Выбрано хранилище PostgreSQL + pgvector (см. [ADR-002](002-postgres-pgvector.md)).

Нужен ORM для работы с БД из NestJS. Варианты:

1. **Prisma** — современный, type-safe, DX-first
2. **TypeORM** — классика в NestJS, знакомо многим
3. **Drizzle ORM** — новый игрок с лучшей поддержкой pgvector
4. **Raw SQL** (через `pg` пакет)

**Проблема:** Prisma **не поддерживает нативно** тип `vector` из pgvector. Надо работать через `Unsupported("vector")` и raw queries для поиска.

## Решение

**Prisma 7 как основной ORM** + **raw queries для векторных операций**.

Паттерн:

```prisma
model DocumentChunk {
  id        Int     @id @default(autoincrement())
  content   String
  embedding Unsupported("vector(1536)")?
  metadata  Json
}
```

Поиск:
```typescript
const results = await prisma.$queryRaw<Chunk[]>`
    SELECT id, content, metadata
    FROM document_chunks
    ORDER BY embedding <=> ${embedding}::vector
    LIMIT 5
`;
```

## Альтернативы

### TypeORM

Плюсы:
- Нативная поддержка pgvector через декораторы:
  ```typescript
  @Column({ type: 'vector', length: 1536 })
  embedding: number[];
  ```
- Знаком большинству NestJS-разработчиков
- Active Record + Data Mapper паттерны

Минусы:
- ⚠️ **DX хуже Prisma** — меньше автодополнения, больше boilerplate
- ⚠️ **Миграции сложнее** — нет `migrate dev` workflow
- ⚠️ **Нет генератора DTO** из схемы (как у Prisma)
- ⚠️ Проект поддерживается слабее в 2026 (Prisma обогнал в популярности)

### Drizzle ORM

Плюсы:
- **Лучшая нативная поддержка pgvector** — first-class type support
- Lightweight, ближе к SQL
- Performance лучше чем Prisma

Минусы:
- ⚠️ Меньше экосистема (NestJS integrations слабее)
- ⚠️ **Нет генератора DTO** для Swagger/class-validator
- ⚠️ Миграции менее зрелые

### Raw SQL только

Плюсы:
- Максимальный контроль
- Без overhead ORM

Минусы:
- ❌ Нет type safety
- ❌ Нет автогенерации DTO
- ❌ Ручные миграции

## Почему Prisma, несмотря на ограничение pgvector

### 1. Автогенерация DTO через `prisma-generator-nestjs-dto`

Изменил схему → одна команда → DTO с `@ApiProperty` + `@IsString` обновились. Это сэкономит **часы** работы на каждой фиче.

TypeORM/Drizzle — пишешь DTO руками.

### 2. DX и Prisma Studio

```bash
npm run prisma:studio     # UI для БД в браузере
npm run prisma:migrate:dev --name add_users
```

Эти штуки ускоряют разработку в 2-3 раза.

### 3. Raw queries — приемлемое решение

Векторные операции = изолированная часть (embed + search). Максимум 10-20 строк raw SQL на фичу. Остальное — красиво через Prisma Client.

### 4. Type safety

```typescript
const user = await prisma.user.findUnique({ where: { id } });
// user.email — типизировано
```

### 5. В 2026 Prisma получила лучшее включение pgvector в roadmap

`previewFeatures = ["postgresqlExtensions"]` — можем минимально настроить. Полная поддержка — вопрос ближайших релизов.

## Последствия

### Плюсы

- ✅ **Type safety** везде кроме raw queries
- ✅ **Автогенерация DTO** — часы сэкономленного времени
- ✅ **Prisma Studio** для дебага
- ✅ **Миграции workflow** превосходит TypeORM
- ✅ **Богатое сообщество** — легко гуглить

### Минусы

- ⚠️ **Raw SQL для pgvector** — 10-20 строк на фичу с RAG
- ⚠️ **Смешанный код** — ORM + SQL требует дисциплины (не размазывать SQL)
- ⚠️ **Риск drift** — если изменится структура `vector` поля, raw queries могут сломаться без compile-ошибки

### Паттерн чистоты

Все raw queries инкапсулированы в **специализированных сервисах** (`VectorSearchService`), а не размазаны по приложению:

```typescript
// libs/rag/src/vector-search.service.ts
@Injectable()
export class VectorSearchService {
    constructor(private prisma: PrismaService) {}

    async searchSimilar(embedding: number[], limit = 5) {
        return this.prisma.$queryRaw<Chunk[]>`
            SELECT id, content, metadata
            FROM document_chunks
            ORDER BY embedding <=> ${embedding}::vector
            LIMIT ${limit}
        `;
    }
}
```

Остальной код приложения использует сервис, не видит SQL.

### Prisma 7: driver adapter и `prisma.config.ts`

С **Prisma 7** изменился способ указания connection URL:

- **`url = env("DATABASE_URL")`** больше не допускается в `datasource db { ... }` в `schema.prisma`. При генерации — `P1012` ошибка.
- Вместо этого URL задаётся в `prisma.config.ts` через `env('DATABASE_URL')` helper, а Prisma CLI читает `.env` через `dotenv/config` (явный импорт в `prisma.config.ts`).
- **Driver adapter обязателен** для запросов. Для Postgres — `@prisma/adapter-pg` (обёртка над `pg`).
- Клиент инстанцируется так:
  ```ts
  new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
  ```

Для slovo это означает: `PrismaService` инжектит `ConfigService`, берёт `DATABASE_URL` через `getOrThrow`, создаёт `PrismaPg` адаптер и передаёт в super-конструктор. Подключение к БД — внутри `$connect()` в `onModuleInit` с try/catch и понятным сообщением об ошибке.

**Следствие:** две точки чтения `DATABASE_URL` — `prisma.config.ts` (для CLI: generate, migrate) и `PrismaService` (для рантайма). Обе используют один и тот же `.env`.

### Multi-file schema

С Prisma 7 стабилизирована `prismaSchemaFolder`. Мы используем её с первого дня: `prisma/schema/` содержит `main.prisma` (`generator` + `datasource`) и по `<feature>.prisma` для каждого домена. Путь задан в `prisma.config.ts` (`schema: 'prisma/schema'`).

Причина: даже одна таблица + enum вынесены отдельно от генератора, чтобы к моменту появления water-analysis и notes-rag не рефакторить схему посреди фичи. Правила разбиения — в `CLAUDE.md` (раздел Prisma schema — multi-file). `prisma-generator-nestjs-dto` совместим, проверено.

### Расширения PostgreSQL — только через миграции

**Источник истины один — миграции Prisma.** В `main.prisma` стоит `extensions = [vector, pg_trgm, uuidOssp(map: "uuid-ossp"), pgcrypto]` и `previewFeatures = ["postgresqlExtensions"]`. Первая же `prisma migrate dev` генерирует `CREATE EXTENSION IF NOT EXISTS ...` для каждого.

**Что мы НЕ делаем:** `./prisma/init:/docker-entrypoint-initdb.d` монтирование с `CREATE EXTENSION` скриптами. Это создаёт drift: Prisma видит расширение в реальной БД, но записи в `_prisma_migrations` нет, и требует `migrate reset`. Каждый `prisma migrate dev` ломается до ручного вмешательства.

**Shadow DB (prisma migrate dev временная база) разворачивается из того же образа `pgvector/pgvector:0.8.2-pg18-trixie`**, поэтому `vector` доступен и в ней — миграция валидируется без init-скрипта.

**PostgreSQL 18 breaking:** volume монтируется в `/var/lib/postgresql` (не `/var/lib/postgresql/data`) — образ сам кладёт данные в major-version subdir. Это требование начиная с PG18 и отражено в `docker-compose.infra.yml`.

### Миграции — только forward, без `down()`

В отличие от TypeORM, у Prisma **нет `down()`-метода** в миграциях — это осознанный выбор команды Prisma. Причины: в реальности `down()` часто пишется лениво/неверно, в prod операции вроде `DROP COLUMN` / `ALTER TYPE` необратимы по данным, а blue/green деплой обычно не нуждается в откате SQL.

**Принцип:** история миграций линейная, всегда вперёд. Если нужен откат — это **новая миграция с обратными изменениями**, применённая поверх.

**Правила для slovo:**

#### Dev

1. **Изменил схему — запустил `prisma migrate dev --name <что>`.** Prisma генерит diff-миграцию. Применяется автоматически.
2. **Сломал dev-БД или хочешь начать с чистого листа** — `npx prisma migrate reset` (требует подтверждение, с AI-агентом — через `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` env). Сносит БД, применяет все миграции с нуля. Сидов пока нет.
3. **Не редактируй уже применённую миграцию вручную** (если `_prisma_migrations` её содержит). Создавай новую с поправками. Исключение: последняя миграция, ещё не пушнутая в git, и ты в одиночку — можно `migrate reset` и переделать.
4. **Не коммить ничего в `prisma/migrations/` без прогона `npm run prisma:migrate:dev`.** Ручные SQL-файлы в папках миграций — флаг для ревью (исключение: ручная миграция с обоснованным комментарием, см. ниже).

#### Production

1. **`npx prisma migrate deploy`** — единственная prod-команда. Применяет только миграции, которых нет в `_prisma_migrations`. Не интерактивная, не создаёт новые.
2. **Откат в prod = новая revert-миграция.** Пишешь её руками (обратные изменения), ревьюишь, деплоишь как обычную миграцию. Линейная история, audit-trail, никакой магии.
3. **Перед каждым `migrate deploy` в prod — автоматический `pg_dump`** (через CI/CD). Если миграция сломает данные — `pg_restore` из backup'а. `migrate resolve --rolled-back` только помечает миграцию откаченной в `_prisma_migrations`, но не возвращает данные.
4. **Разрушающие операции (`DROP COLUMN`, `DROP TABLE`, `ALTER COLUMN TYPE`) требуют отдельного PR** с обсуждением. Часто безопаснее: `ADD new_column` → deploy → backfill → switch code → drop old (3 миграции).

#### Ручная правка migration.sql

Иногда Prisma генерит не совсем то, что нужно — например, добавление HNSW-индекса для pgvector (Prisma не умеет декларативно задавать vector-индексы). Тогда:

1. `prisma migrate dev --create-only --name add_hnsw_index` — создаёт миграцию без применения.
2. Руками дописываешь в `migration.sql`: `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops);`
3. `prisma migrate dev` — применяет.
4. В PR-description — **обязательно** описать что и зачем изменено вручную.

### Когда пересмотреть

- Prisma добавляет нативную поддержку `vector` → убираем `Unsupported`
- Объём raw SQL превышает 30% кодовой базы → переход на Drizzle
- Появится нужда в сложных vector-aggregations которых Prisma не выразит — возможно гибрид Prisma + Drizzle для разных модулей
