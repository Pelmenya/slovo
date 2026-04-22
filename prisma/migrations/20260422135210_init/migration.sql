-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "health_check_status" AS ENUM ('ok', 'degraded', 'down');

-- CreateTable
CREATE TABLE "health_checks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "service" VARCHAR(64) NOT NULL,
    "status" "health_check_status" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "health_checks_service_created_at_idx" ON "health_checks"("service", "created_at");
