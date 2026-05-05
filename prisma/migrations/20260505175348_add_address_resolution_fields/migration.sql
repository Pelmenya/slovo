-- AlterTable: water_analysis_raw — add address-resolution fields для Этапа 1.B
-- Step 1: TS pre-clean → address_pre_cleaned
-- Step 2: Ahunter cleanse → ahunter_cleansed (full JSONB) + denormalized geo fields
-- Step 3: AI verification → ai_verified

ALTER TABLE "water_analysis_raw"
    ADD COLUMN "address_pre_cleaned" VARCHAR(512),
    ADD COLUMN "address_pre_cleaned_at" TIMESTAMP(3),
    ADD COLUMN "ahunter_cleansed" JSONB,
    ADD COLUMN "ahunter_cleansed_at" TIMESTAMP(3),
    ADD COLUMN "ahunter_cleansed_tier" VARCHAR(20),
    ADD COLUMN "ahunter_cleansed_query" VARCHAR(512),
    ADD COLUMN "geo_lat" DOUBLE PRECISION,
    ADD COLUMN "geo_lon" DOUBLE PRECISION,
    ADD COLUMN "geo_region" VARCHAR(64),
    ADD COLUMN "geo_city" VARCHAR(64),
    ADD COLUMN "geo_pretty" VARCHAR(512),
    ADD COLUMN "geo_level" VARCHAR(16),
    ADD COLUMN "ai_verified" VARCHAR(16),
    ADD COLUMN "ai_verified_at" TIMESTAMP(3),
    ADD COLUMN "ai_verified_notes" VARCHAR(512);

-- CreateIndex
CREATE INDEX "water_analysis_raw_ahunter_cleansed_at_idx"
    ON "water_analysis_raw"("ahunter_cleansed_at");

CREATE INDEX "water_analysis_raw_ai_verified_idx"
    ON "water_analysis_raw"("ai_verified");

CREATE INDEX "water_analysis_raw_geo_lat_geo_lon_idx"
    ON "water_analysis_raw"("geo_lat", "geo_lon");
