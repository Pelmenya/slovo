-- Phase 2: добавляем embedding_text + embedding для семантического поиска похожих анализов.
--
-- embedding_text TEXT     — natural language description (генерится через generateEmbeddingText)
-- embedding vector(1536)  — OpenAI text-embedding-3-small output
-- HNSW индекс по cosine similarity для radial nearest-neighbor search
--
-- Decoupling: embedding_text заполняется детерминированным TS-генератором (Phase 2 step 1),
-- embedding — отдельным batch-скриптом через OpenAI API (Phase 2 step 2).
-- Это позволяет:
--   - Sanity check текста глазами перед embedding-вызовом
--   - A/B testing разных text-templates без re-embeddинга всех записей сразу
--   - Re-embedд'ить если поменяем модель (text → новый embedding без re-генерации текста)
--
-- HNSW параметры (m=16, ef_construction=64) — defaults для 15k-100k записей.
-- При росте до 1M+ возможно потребуется ef_construction=128.

ALTER TABLE "water_analysis"
    ADD COLUMN "embedding_text" TEXT,
    ADD COLUMN "embedding" vector(1536);

CREATE INDEX "water_analysis_embedding_hnsw_idx" ON "water_analysis"
    USING hnsw ("embedding" vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
