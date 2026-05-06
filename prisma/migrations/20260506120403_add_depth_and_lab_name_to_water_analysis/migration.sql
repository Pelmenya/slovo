-- Этап 1.B follow-up: добавляем depthMeters и labName в WaterAnalysis.
-- Эти поля Vision уже извлекает в vision_payload (depthMeters в 55.7% бланков, labName в 100%),
-- но 05-normalize.ts их не переносил в derived. Bug fix через ALTER + re-run normalize.
--
-- depth_meters важен для подбора оборудования (артезианская скважина >100м vs верховодка <25м).
-- lab_name для аудита качества по лабораториям.

ALTER TABLE "water_analysis"
    ADD COLUMN "depth_meters" DOUBLE PRECISION,
    ADD COLUMN "lab_name" VARCHAR(256);

CREATE INDEX "water_analysis_depth_meters_idx" ON "water_analysis" ("depth_meters") WHERE "depth_meters" IS NOT NULL;
