-- Этап 1.A.5 follow-up — конвертация VarChar → enum для двух колонок WaterAnalysisRaw.
-- Tech-debt #21: защита от опечаток ('OK' vs 'ok', 'place' vs 'Place') в downstream queries.
--
-- Реальные значения в БД на 2026-05-06 (проверено перед миграцией):
--   ai_verified: ok (10846), uncertain (633), wrong (469) — всё mappable.
--   geo_level: Place (4580), City (3375), Street (1609), Site (1308),
--              District (710), Region (366) — всё mappable.
--
-- ahunter_cleansed_tier (5 значений включая 'suggest+strict' с '+') в enum
-- НЕ конвертится — '+' запрещён в Prisma enum identifier. Оставлено VarChar(20).

-- 1. Создаём enum types
CREATE TYPE "water_address_verification" AS ENUM ('ok', 'uncertain', 'wrong');

CREATE TYPE "water_geo_level" AS ENUM ('Region', 'District', 'City', 'Place', 'Site', 'Street');

-- 2. ALTER COLUMN с USING cast — безопасно: все значения в БД легально mappable
ALTER TABLE "water_analysis_raw"
    ALTER COLUMN "ai_verified" TYPE "water_address_verification"
    USING "ai_verified"::"water_address_verification";

ALTER TABLE "water_analysis_raw"
    ALTER COLUMN "geo_level" TYPE "water_geo_level"
    USING "geo_level"::"water_geo_level";
