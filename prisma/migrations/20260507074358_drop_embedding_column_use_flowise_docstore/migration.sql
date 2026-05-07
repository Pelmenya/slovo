-- Phase 2 архитектурный pivot 2026-05-07: переход с прямого OpenAI SDK на
-- Flowise Document Store как и для catalog-aquaphor (consistency с ADR-006 +
-- memory project_flowise_runtime_decision: «Flowise = LLM runtime + RAG слой»).
--
-- Откат предыдущей миграции 20260507073433_add_embedding_to_water_analysis:
--   - DROP колонка embedding vector(1536)
--   - DROP HNSW индекс
--   - embedding_text TEXT остаётся — он передаётся в Flowise loader'е
--
-- Forward-only: создаём новую миграцию которая откатывает прошлую (стандартная
-- Prisma practice, не amend applied миграцию).
--
-- Embedding'и теперь хранятся в Flowise-managed таблице
-- <docstoreId>_chunks (PostgresVectorStore через Flowise Document Store
-- "water-analysis-aquaphor"). Изолировано от catalog-aquaphor (разные таблицы).

DROP INDEX IF EXISTS "water_analysis_embedding_hnsw_idx";

ALTER TABLE "water_analysis" DROP COLUMN IF EXISTS "embedding";

-- embedding_text TEXT остаётся — он передаётся как content в Flowise loader.
