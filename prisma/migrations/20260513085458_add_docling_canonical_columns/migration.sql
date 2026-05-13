-- Slice 3a (docling-migration, 2026-05-13): canonical merge provenance + re-geocode/re-embed slots.
-- Additive only: existing колонки, индексы и PostGIS GENERATED columns не трогаются.
-- Drift между Prisma 7 schema и PostGIS GENERATED ALWAYS AS на geo_point — игнорируем
-- (Prisma не понимает GENERATED syntax, хочет DROP DEFAULT — НЕ применяем).

-- water_analysis_raw: какой engine сделал extraction.
--   'vision-haiku-4.5'   — Vision-Haiku через Flowise (existing 15504)
--   'docling-2.74'        — Docling deterministic (Slice 3b ETL для новых)
ALTER TABLE "water_analysis_raw"
    ADD COLUMN "extraction_engine" VARCHAR(32),
    ADD COLUMN "extraction_engine_version" VARCHAR(32);

-- water_analysis: provenance intake + re-geocode/re-embed slots.
ALTER TABLE "water_analysis"
    ADD COLUMN "intake_source" VARCHAR(32),
    ADD COLUMN "canonical_lat" DOUBLE PRECISION,
    ADD COLUMN "canonical_lon" DOUBLE PRECISION,
    ADD COLUMN "canonical_fias_id" VARCHAR(64),
    ADD COLUMN "canonical_address_new" VARCHAR(512),
    ADD COLUMN "regeocoded_at" TIMESTAMP(3),
    ADD COLUMN "params_canonical" JSONB,
    ADD COLUMN "reembedded_at" TIMESTAMP(3);

-- Indexes для частых query patterns в downstream.
CREATE INDEX "water_analysis_raw_extraction_engine_idx" ON "water_analysis_raw"("extraction_engine");
CREATE INDEX "water_analysis_intake_source_idx" ON "water_analysis"("intake_source");
CREATE INDEX "water_analysis_regeocoded_at_idx" ON "water_analysis"("regeocoded_at");
CREATE INDEX "water_analysis_reembedded_at_idx" ON "water_analysis"("reembedded_at");
