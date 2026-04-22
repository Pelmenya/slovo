// dotenv/config загружает .env для Prisma CLI (generate/migrate) — без него env('DATABASE_URL') не резолвится
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
    schema: 'prisma/schema.prisma',
    migrations: {
        path: 'prisma/migrations',
    },
    datasource: {
        url: env('DATABASE_URL'),
    },
});
