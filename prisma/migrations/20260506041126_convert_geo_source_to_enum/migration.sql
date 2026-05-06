-- Конвертация geo_source VARCHAR(20) → enum WaterGeocodeSource.
-- Защита от опечаток ('Ahunter_Cleanse' vs 'ahunter_cleanse') в downstream queries
-- и при INSERT через скрипты Этапа 1.A.5 / 1.B.
--
-- Реальные значения в БД на момент миграции (проверено через GROUP BY):
--   ahunter_cleanse — 11 948 records
--   NULL            — 3 556 records
--
-- После миграции добавятся:
--   dealer_median   — fallback из 07-dealer-median-fallback.ts (#38)
--   manual_override — manual lookup для top-dealers (#36)

CREATE TYPE "water_geocode_source" AS ENUM ('ahunter_cleanse', 'dealer_median', 'manual_override');

ALTER TABLE "water_analysis_raw"
    ALTER COLUMN "geo_source" TYPE "water_geocode_source"
    USING "geo_source"::"water_geocode_source";
