-- add voice domain (Clinic, Call, CallTurn + enums). Только voice_* объекты:
-- дрифт water_analysis (geo_point) намеренно исключён — чужой домен.

-- CreateEnum
CREATE TYPE "voice_call_status" AS ENUM ('pending', 'dialing', 'in_progress', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "voice_call_outcome" AS ENUM ('confirmed', 'canceled', 'reschedule_requested', 'unclear', 'no_answer', 'failed');

-- CreateEnum
CREATE TYPE "voice_turn_role" AS ENUM ('robot', 'patient');

-- CreateEnum
CREATE TYPE "voice_intent" AS ENUM ('confirm', 'cancel', 'reschedule', 'unclear');

-- CreateTable
CREATE TABLE "voice_clinic" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(256) NOT NULL,
    "tts_voice" VARCHAR(32) NOT NULL DEFAULT 'alena',
    "phrase_templates" JSONB,
    "env_namespace" VARCHAR(64) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_clinic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_call" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "clinic_id" UUID NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "patient_name" VARCHAR(256) NOT NULL,
    "appointment_at" TIMESTAMP(3) NOT NULL,
    "status" "voice_call_status" NOT NULL DEFAULT 'pending',
    "outcome" "voice_call_outcome",
    "channel_id" VARCHAR(128),
    "dialed_at" TIMESTAMP(3),
    "answered_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "duration_seconds" INTEGER,
    "tts_chars" INTEGER NOT NULL DEFAULT 0,
    "stt_seconds" INTEGER NOT NULL DEFAULT 0,
    "llm_input_tokens" INTEGER NOT NULL DEFAULT 0,
    "llm_output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_kopecks" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_call_turn" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "call_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "role" "voice_turn_role" NOT NULL,
    "text" TEXT NOT NULL,
    "intent" "voice_intent",
    "recording_path" VARCHAR(512),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_call_turn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "voice_clinic_env_namespace_key" ON "voice_clinic"("env_namespace");

-- CreateIndex
CREATE INDEX "voice_call_clinic_id_idx" ON "voice_call"("clinic_id");

-- CreateIndex
CREATE INDEX "voice_call_phone_idx" ON "voice_call"("phone");

-- CreateIndex
CREATE INDEX "voice_call_status_idx" ON "voice_call"("status");

-- CreateIndex
CREATE INDEX "voice_call_turn_call_id_idx" ON "voice_call_turn"("call_id");

-- AddForeignKey
ALTER TABLE "voice_call" ADD CONSTRAINT "voice_call_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "voice_clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_call_turn" ADD CONSTRAINT "voice_call_turn_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "voice_call"("id") ON DELETE CASCADE ON UPDATE CASCADE;
