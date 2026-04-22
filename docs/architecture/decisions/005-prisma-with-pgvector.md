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

### Когда пересмотреть

- Prisma добавляет нативную поддержку `vector` → убираем `Unsupported`
- Объём raw SQL превышает 30% кодовой базы → переход на Drizzle
- Появится нужда в сложных vector-aggregations которых Prisma не выразит — возможно гибрид Prisma + Drizzle для разных модулей
