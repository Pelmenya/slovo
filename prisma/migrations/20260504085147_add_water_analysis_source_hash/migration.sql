-- AlterTable
ALTER TABLE "water_analysis_raw" ADD COLUMN     "source_file_hash" VARCHAR(64);

-- CreateIndex
CREATE INDEX "water_analysis_raw_source_file_hash_idx" ON "water_analysis_raw"("source_file_hash");

