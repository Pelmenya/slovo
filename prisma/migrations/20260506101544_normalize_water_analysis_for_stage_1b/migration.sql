-- Этап 1.B: пересобираем WaterAnalysis под новую структуру нормализации.
-- Таблица water_analysis на момент миграции пуста (0 rows) — drop/add safe.
--
-- Изменения:
--   1. Variant A (без PII): DROP customer_name_ref.
--   2. Старый GeocodeSource enum (blank/dealer_fallback/none) удаляется.
--      Заменяется на WaterGeocodeSource (ahunter_cleanse/dealer_median/manual_override),
--      такой же как в water_analysis_raw для consistency.
--   3. params Json остаётся, но смысл меняется: теперь { paramCode: number },
--      без unit/exceedsPdk inside (exceedsPdk вычисляется в runtime через @slovo/water-blank-extraction).
--   4. ADD param_flags JSONB     — особые случаи парсинга (below_detection / above_limit / range / not_detected / unit_mismatch / duplicate)
--   5. ADD params_unknown JSONB  — амбивалентные / OCR-галлюцинации raw.name для review и расширения PARAM_SYNONYMS
--   6. ADD geo_point geography(Point, 4326) GENERATED ALWAYS AS STORED — синхронизирован из lat/lon
--      (зеркалит water_analysis_raw.geo_point — для radial-search в Этапе 2)
--   7. CREATE INDEX GIST(geo_point), btree(geo_source)

-- 1. Drop PII column
ALTER TABLE "water_analysis" DROP COLUMN "customer_name_ref";

-- 2. Drop old geocode_source column + enum, add new geo_source via WaterGeocodeSource
ALTER TABLE "water_analysis" DROP COLUMN "geocode_source";
DROP TYPE "geocode_source";

ALTER TABLE "water_analysis" ADD COLUMN "geo_source" "water_geocode_source";

-- 3-4. Add param_flags + params_unknown JSONB (default '{}' — на пустую таблицу безопасно,
--      derive скрипт всегда заполняет явно)
ALTER TABLE "water_analysis" ADD COLUMN "param_flags" JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "water_analysis" ADD COLUMN "params_unknown" JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 6. Add geo_point GENERATED column (зеркало water_analysis_raw.geo_point)
ALTER TABLE "water_analysis"
    ADD COLUMN "geo_point" geography(Point, 4326)
    GENERATED ALWAYS AS (
        CASE
            WHEN "lat" IS NOT NULL AND "lon" IS NOT NULL
            THEN ST_SetSRID(ST_MakePoint("lon", "lat"), 4326)::geography
            ELSE NULL
        END
    ) STORED;

-- 7. Indexes
CREATE INDEX "water_analysis_geo_point_idx" ON "water_analysis" USING GIST ("geo_point");
CREATE INDEX "water_analysis_geo_source_idx" ON "water_analysis" ("geo_source");
