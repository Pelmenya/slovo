-- CHECK-констрейнты для knowledge_sources.
-- Prisma 7 не поддерживает CHECK декларативно в schema.prisma — поэтому ручной
-- SQL через `prisma migrate dev --create-only` (forward-only, см. ADR-005).
-- Обзор constraint'ов зафиксирован в docs/architecture/decisions/006-knowledge-base-as-first-feature.md.

-- 1) Ровно одно из полиморфных полей заполнено на момент создания источника.
--    storage_key      → для video/audio/pdf/docx (в S3 лежит blob)
--    source_url       → для youtube/article URL адаптеров
--    raw_text         → для text адаптера (текст передан как есть)
--    extracted_text   — НЕ участвует: заполняется адаптером ПОСЛЕ ingestion, исходно null.
--    error            — НЕ участвует: заполняется только при failed-статусе.
ALTER TABLE "knowledge_sources"
    ADD CONSTRAINT "knowledge_sources_payload_exclusive_chk"
    CHECK (
        ("storage_key" IS NOT NULL)::int
      + ("source_url" IS NOT NULL)::int
      + ("raw_text" IS NOT NULL)::int
      = 1
    );

-- 2) Progress — 0..100 включительно. Baseline 0 (pending), 100 (ready).
--    Защита от багов worker'а, который мог бы записать 150% или -5%.
ALTER TABLE "knowledge_sources"
    ADD CONSTRAINT "knowledge_sources_progress_range_chk"
    CHECK ("progress" BETWEEN 0 AND 100);
