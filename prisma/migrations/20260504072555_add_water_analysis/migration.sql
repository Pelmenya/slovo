-- CreateEnum
CREATE TYPE "water_source_type" AS ENUM ('well', 'well_dug', 'municipal', 'spring', 'river', 'other');

-- CreateEnum
CREATE TYPE "geocode_source" AS ENUM ('blank', 'dealer_fallback', 'none');

-- CreateTable
CREATE TABLE "water_analysis_raw" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_number" VARCHAR(32) NOT NULL,
    "source_file_name" VARCHAR(512) NOT NULL,
    "filename_meta" JSONB NOT NULL,
    "vision_payload" JSONB NOT NULL,
    "vision_model" VARCHAR(64) NOT NULL,
    "vision_tokens_in" INTEGER NOT NULL,
    "vision_tokens_out" INTEGER NOT NULL,
    "ahunter_raw_address" VARCHAR(512),
    "ahunter_raw_response" JSONB,
    "ahunter_dealer_response" JSONB,
    "extracted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "water_analysis_raw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "water_analysis" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "raw_id" UUID NOT NULL,
    "order_number" VARCHAR(32) NOT NULL,
    "source_file_name" VARCHAR(512) NOT NULL,
    "sample_date" DATE NOT NULL,
    "test_date" DATE,
    "intake_type" "water_source_type" NOT NULL,
    "appearance" VARCHAR(256),
    "params" JSONB NOT NULL,
    "canonical_address" VARCHAR(512),
    "fias_id" VARCHAR(64),
    "region" VARCHAR(128),
    "district" VARCHAR(128),
    "locality" VARCHAR(128),
    "lat" DOUBLE PRECISION,
    "lon" DOUBLE PRECISION,
    "geocode_source" "geocode_source" NOT NULL,
    "dealer_location" VARCHAR(256),
    "customer_name_ref" UUID,
    "normalization_version" VARCHAR(16) NOT NULL,
    "normalized_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "water_analysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "water_analysis_raw_order_number_key" ON "water_analysis_raw"("order_number");

-- CreateIndex
CREATE INDEX "water_analysis_raw_extracted_at_idx" ON "water_analysis_raw"("extracted_at");

-- CreateIndex
CREATE UNIQUE INDEX "water_analysis_raw_id_key" ON "water_analysis"("raw_id");

-- CreateIndex
CREATE UNIQUE INDEX "water_analysis_order_number_key" ON "water_analysis"("order_number");

-- CreateIndex
CREATE INDEX "water_analysis_region_district_idx" ON "water_analysis"("region", "district");

-- CreateIndex
CREATE INDEX "water_analysis_sample_date_idx" ON "water_analysis"("sample_date");

-- CreateIndex
CREATE INDEX "water_analysis_intake_type_idx" ON "water_analysis"("intake_type");

-- CreateIndex
CREATE INDEX "water_analysis_normalization_version_idx" ON "water_analysis"("normalization_version");

-- AddForeignKey
ALTER TABLE "water_analysis" ADD CONSTRAINT "water_analysis_raw_id_fkey" FOREIGN KEY ("raw_id") REFERENCES "water_analysis_raw"("id") ON DELETE CASCADE ON UPDATE CASCADE;

