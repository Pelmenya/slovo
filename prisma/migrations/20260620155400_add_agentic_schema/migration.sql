-- Agentic core — vertical slice MVP schema.
--
-- Pлан:  docs/features/agentic-core.md
-- ADR:   docs/architecture/decisions/011-agentic-core-runner-orchestration.md
--
-- Применена вручную через psql (drift workaround для Flowise-managed таблиц,
-- см. CLAUDE.md → «Drift от Flowise-managed таблиц» + memory
-- `feedback_prisma_drift_flowise_workaround`).
--
-- water_analysis_* DROP INDEX / DROP DEFAULT artifacts из migrate diff —
-- НЕ включены (это legacy drift от ручных миграций, отдельно адресуем
-- если/когда понадобится). Этот файл — pure additive agentic-only.

-- CreateEnum
CREATE TYPE "agent_run_status" AS ENUM ('created', 'planning', 'awaiting_permission', 'executing', 'done', 'failed', 'aborted', 'aborted_by_timeout');

-- CreateEnum
CREATE TYPE "agent_run_event_type" AS ENUM ('plan', 'tool_call', 'permission_request', 'permission_response', 'tool_result', 'evidence', 'model_call', 'error', 'quarantine', 'done', 'abort');

-- CreateEnum
CREATE TYPE "agent_permission_status" AS ENUM ('pending', 'approved', 'rejected', 'timed_out');

-- CreateEnum
CREATE TYPE "agent_permission_risk_level" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "agent_model_tier" AS ENUM ('frontier', 'verified', 'experimental');

-- CreateTable
CREATE TABLE "agent_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "title" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "parent_run_id" UUID,
    "resumed_from_run_id" UUID,
    "goal" TEXT NOT NULL,
    "status" "agent_run_status" NOT NULL,
    "budget_spent_usd" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "budget_cap_usd" DECIMAL(10,6) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_run_events" (
    "id" BIGSERIAL NOT NULL,
    "run_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" "agent_run_event_type" NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_run_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_run_snapshots" (
    "run_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "state" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_run_snapshots_pkey" PRIMARY KEY ("run_id","seq")
);

-- CreateTable
CREATE TABLE "agent_permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "action" VARCHAR(32) NOT NULL,
    "tool_name" VARCHAR(128) NOT NULL,
    "args" JSONB NOT NULL,
    "risk_level" "agent_permission_risk_level" NOT NULL DEFAULT 'medium',
    "status" "agent_permission_status" NOT NULL DEFAULT 'pending',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMP(3),
    "responded_by" UUID,
    "reason" TEXT,

    CONSTRAINT "agent_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_model_health" (
    "provider" VARCHAR(64) NOT NULL,
    "model" VARCHAR(128) NOT NULL,
    "tier" "agent_model_tier" NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "quarantined_at" TIMESTAMP(3),
    "quarantine_reason" TEXT,
    "fail_count" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "last_probe_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_model_health_pkey" PRIMARY KEY ("provider","model")
);

-- CreateIndex
CREATE INDEX "agent_sessions_user_id_created_at_idx" ON "agent_sessions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_runs_session_id_created_at_idx" ON "agent_runs"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_runs_status_created_at_idx" ON "agent_runs"("status", "created_at");

-- CreateIndex
CREATE INDEX "agent_run_events_run_id_created_at_idx" ON "agent_run_events"("run_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_run_events_run_id_seq_key" ON "agent_run_events"("run_id", "seq");

-- CreateIndex
CREATE INDEX "agent_run_snapshots_run_id_created_at_idx" ON "agent_run_snapshots"("run_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_permissions_run_id_status_idx" ON "agent_permissions"("run_id", "status");

-- CreateIndex
CREATE INDEX "agent_permissions_status_requested_at_idx" ON "agent_permissions"("status", "requested_at");

-- CreateIndex
CREATE INDEX "agent_model_health_quarantined_at_idx" ON "agent_model_health"("quarantined_at");

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run_events" ADD CONSTRAINT "agent_run_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run_snapshots" ADD CONSTRAINT "agent_run_snapshots_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_permissions" ADD CONSTRAINT "agent_permissions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed ModelHealth (Phase 1, A1 + A6):
--   open primary  → openrouter/qwen/qwen3
--   open alt      → openrouter/moonshotai/kimi-k2 (для A/B в Phase 9)
--   frontier      → anthropic/claude-haiku-4-5 (baseline + fallback на quarantine open)
INSERT INTO "agent_model_health" ("provider", "model", "tier", "verified", "updated_at") VALUES
    ('openrouter', 'qwen/qwen3', 'verified', true, CURRENT_TIMESTAMP),
    ('openrouter', 'moonshotai/kimi-k2', 'verified', true, CURRENT_TIMESTAMP),
    ('anthropic', 'claude-haiku-4-5', 'verified', true, CURRENT_TIMESTAMP);
