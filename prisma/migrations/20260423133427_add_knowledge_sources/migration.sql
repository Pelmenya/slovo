-- CreateEnum
CREATE TYPE "knowledge_source_type" AS ENUM ('text', 'video', 'audio', 'pdf', 'docx', 'youtube', 'article');

-- CreateEnum
CREATE TYPE "knowledge_source_status" AS ENUM ('pending', 'processing', 'ready', 'failed');

-- CreateTable
CREATE TABLE "knowledge_sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "source_type" "knowledge_source_type" NOT NULL,
    "status" "knowledge_source_status" NOT NULL DEFAULT 'pending',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "title" VARCHAR(256),
    "storage_key" TEXT,
    "source_url" TEXT,
    "raw_text" TEXT,
    "extracted_text" TEXT,
    "metadata" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "knowledge_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_sources_user_id_created_at_idx" ON "knowledge_sources"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "knowledge_sources_status_created_at_idx" ON "knowledge_sources"("status", "created_at");
