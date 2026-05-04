// dotenv/config загружает .env для Prisma CLI (generate/migrate) — без него env('DATABASE_URL') не резолвится
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
    schema: 'prisma/schema',
    migrations: {
        path: 'prisma/migrations',
    },
    datasource: {
        url: env('DATABASE_URL'),
        // Shadow DB — обходит drift от Flowise-managed таблиц (Document Store создаёт
        // catalog_chunks / catalog_record_manager через TypeORM вне Prisma migration history).
        // Без shadow URL `migrate dev` хочет reset, что снесёт catalog 155 товаров и knowledge_sources.
        // БД создаётся вручную: docker exec slovo-postgres psql -U slovo -d postgres -c "CREATE DATABASE slovo_shadow OWNER slovo;"
        shadowDatabaseUrl: env('SHADOW_DATABASE_URL'),
    },
});
