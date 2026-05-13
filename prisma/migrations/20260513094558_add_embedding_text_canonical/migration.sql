-- Slice 4.2.5b (docling-migration, 2026-05-13): embedding_text_canonical для merged params.
-- Additive only. Existing embedding_text column нетронут.

ALTER TABLE "water_analysis"
    ADD COLUMN "embedding_text_canonical" TEXT;
