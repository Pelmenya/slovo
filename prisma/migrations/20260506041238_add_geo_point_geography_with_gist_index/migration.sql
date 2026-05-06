-- PostGIS geography(Point, 4326) колонка для true spatial NN-поиск.
--
-- GENERATED ALWAYS AS ... STORED — Postgres автоматически вычисляет geo_point
-- при каждом INSERT/UPDATE из geo_lat/geo_lon. Никаких triggers / manual sync.
-- Read-only с точки зрения приложения (Prisma знает про колонку, но не пишет в неё).
--
-- SRID 4326 = WGS84 = стандартные lat/lon координаты от Ahunter / GPS.
-- ::geography (не ::geometry) даёт Earth-aware расчёты (ST_Distance в метрах,
-- ST_DWithin в метрах) без ручных Haversine формул.
--
-- GiST индекс — стандартный spatial index для PostGIS, O(log N) на радиальный
-- поиск. На 15 504 точках overhead минимален, выигрыш огромный для запросов
-- типа `ORDER BY ST_Distance(...) LIMIT 10`.
--
-- Тест проведён на temp таблице — STORED работает с PostGIS expressions.

ALTER TABLE "water_analysis_raw"
    ADD COLUMN "geo_point" geography(Point, 4326)
    GENERATED ALWAYS AS (
        CASE
            WHEN "geo_lat" IS NOT NULL AND "geo_lon" IS NOT NULL
            THEN ST_SetSRID(ST_MakePoint("geo_lon", "geo_lat"), 4326)::geography
            ELSE NULL
        END
    ) STORED;

CREATE INDEX "water_analysis_raw_geo_point_idx"
    ON "water_analysis_raw"
    USING GIST ("geo_point");
