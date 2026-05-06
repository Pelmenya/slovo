-- Tech-debt #22 — PostGIS extension для будущих spatial-фич water-analysis.
--
-- Что даёт:
--   - geography(Point, 4326) тип для координат с проекцией WGS84
--   - ST_DWithin / ST_Distance / ST_DistanceSphere для радиального поиска
--   - GiST индекс на geography для true spatial NN-поиск
--   - Поддержка полигонов (для районов МО на тепловой карте Этапа 3)
--   - WKT / GeoJSON serialization
--
-- На момент миграции:
--   - geo_lat / geo_lon в `water_analysis_raw` остаются как есть (DOUBLE PRECISION)
--   - Composite btree индекс (geo_lat, geo_lon) сохраняется для bounding-box queries
--   - Расчётные `geography` колонки появятся в Этапе 1.B (`WaterAnalysis`) или Этапе 3
--     (UI «найди в радиусе»), не сейчас
--
-- Закрывает: tech-debt #22 unblocking. Триггер «при росте × 10 / появлении UI
-- найди-в-радиусе» больше не блокирует — extension готов.

CREATE EXTENSION IF NOT EXISTS postgis;
