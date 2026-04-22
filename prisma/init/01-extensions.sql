-- Расширения PostgreSQL которые нам нужны
-- Применяется автоматически при первом запуске контейнера

CREATE EXTENSION IF NOT EXISTS vector;       -- pgvector: векторы + поиск по embeddings
CREATE EXTENSION IF NOT EXISTS pg_trgm;       -- триграммы: быстрый поиск по подстроке, опечаткам
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";   -- UUID
CREATE EXTENSION IF NOT EXISTS pgcrypto;      -- хеши, шифрование
