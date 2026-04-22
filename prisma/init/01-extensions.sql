-- Bootstrap-расширение для pgvector
-- Применяется автоматически при первом запуске контейнера pgvector.
--
-- Почему ТОЛЬКО vector здесь, а pg_trgm/uuid-ossp/pgcrypto — через Prisma:
-- Prisma 7 валидирует schema.prisma на shadow-БД до создания миграции. Если
-- в schema.prisma объявлен тип Unsupported("vector") или extensions=[vector],
-- а расширения в shadow-БД ещё нет — валидация упадёт. Поэтому vector нужен
-- ДО Prisma CLI, прямо в docker-entrypoint-initdb.
-- Остальные (pg_trgm, uuid-ossp, pgcrypto) объявлены в schema.prisma через
-- extensions=[...] и создаются первой миграцией — там conflict'а нет.

CREATE EXTENSION IF NOT EXISTS vector;
