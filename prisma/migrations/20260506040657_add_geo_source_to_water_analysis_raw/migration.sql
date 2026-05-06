-- Этап 1.A.5 / dealer-median fallback (#38) — поле для отметки источника координат.
--
-- Значения:
--   'ahunter_cleanse'  — координаты получены через Ahunter /cleanse (Этап 1.A.5 happy path)
--   'dealer_median'    — fallback: median lat/lon из ok-records того же dealer'а
--   'manual_override'  — ручная установка для top-dealers без геоинфы (#36)
--   NULL                — ещё нет координат (для записей без geo_lat/lon)
--
-- Backfill: текущие 11 948 records с geo_lat IS NOT NULL получают 'ahunter_cleanse'.
-- 3 556 no_match/empty остаются NULL (получат 'dealer_median' или останутся NULL после
-- скрипта 07-dealer-median-fallback.ts).
--
-- Колонка VarChar(20) — не enum по той же причине что ahunter_cleansed_tier:
-- избегаем '+' / специальных символов; список значений может расшириться позже
-- (например, 'ahunter_fetch' для legacy /fetch/address результатов).

ALTER TABLE "water_analysis_raw"
    ADD COLUMN "geo_source" VARCHAR(20);

-- Backfill: уже imported координаты помечаем как ahunter_cleanse
UPDATE "water_analysis_raw"
SET "geo_source" = 'ahunter_cleanse'
WHERE "geo_lat" IS NOT NULL;

CREATE INDEX "water_analysis_raw_geo_source_idx"
    ON "water_analysis_raw"("geo_source");
