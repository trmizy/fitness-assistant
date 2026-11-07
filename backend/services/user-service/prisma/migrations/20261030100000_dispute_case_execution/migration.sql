-- DISPUTE CASE slice 2 / S2.1 (CaseDecision executor). Additive only: two enums, two columns on dispute_cases, one nullable column on sessions,
-- one append-only table. No existing row changes meaning; no row is created for any existing session. Generated DDL (prisma migrate diff against a
-- database with every earlier migration applied) WITHOUT its DropIndex of dispute_case_statements_unique_version (a hand-written Slice 1 constraint the
-- schema DSL cannot express), followed by the hand-written constraints below.

-- CreateEnum
CREATE TYPE "DisputeCaseExecStatus" AS ENUM ('NOT_STARTED', 'EXECUTING', 'BUSINESS_DONE', 'EXEC_BLOCKED', 'NEEDS_HUMAN');

-- CreateEnum
CREATE TYPE "DisputeCaseExecutionState" AS ENUM ('STARTED', 'BUSINESS_DONE', 'BLOCKED', 'NEEDS_HUMAN');

-- AlterTable
ALTER TABLE "dispute_cases" ADD COLUMN     "exec_decision_id" UUID,
ADD COLUMN     "exec_status" "DisputeCaseExecStatus" NOT NULL DEFAULT 'NOT_STARTED';

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "resolved_by_case_decision_id" TEXT;

-- CreateTable
CREATE TABLE "dispute_case_executions" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "decision_id" UUID NOT NULL,
    "session_id" TEXT NOT NULL,
    "outcome" "DisputeCaseOutcome" NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "state" "DisputeCaseExecutionState" NOT NULL,
    "blocked_reason" TEXT,
    "response" JSONB,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_case_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dispute_case_executions_case_id_created_at_idx" ON "dispute_case_executions"("case_id", "created_at");

-- CreateIndex
CREATE INDEX "dispute_case_executions_idempotency_key_idx" ON "dispute_case_executions"("idempotency_key");

-- AddForeignKey
ALTER TABLE "dispute_case_executions" ADD CONSTRAINT "dispute_case_executions_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "dispute_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── hand-written constraints (the schema DSL cannot express them) ────────────────────────────────────────────────────────

-- A CaseDecision rules at most ONE session (and a session is ruled by at most one decision): the stable decision <-> session link.
CREATE UNIQUE INDEX "sessions_resolved_by_case_decision_id_key" ON "sessions"("resolved_by_case_decision_id") WHERE "resolved_by_case_decision_id" IS NOT NULL;

-- At most one STARTED row per (idempotency key, attempt) and at most one BUSINESS_DONE row per key (CASE_DECISION:<decisionId>): even a bug in the executor
-- cannot start the same attempt or finish a decision twice. (A retry after an EXEC_BLOCKED is a new attempt.)
CREATE UNIQUE INDEX "dispute_case_executions_one_started_per_attempt" ON "dispute_case_executions"("idempotency_key", "attempt") WHERE "state" = 'STARTED';
CREATE UNIQUE INDEX "dispute_case_executions_one_done_per_key" ON "dispute_case_executions"("idempotency_key") WHERE "state" = 'BUSINESS_DONE';

-- The key always names the decision it executes.
ALTER TABLE "dispute_case_executions" ADD CONSTRAINT "dispute_case_executions_key_matches_decision" CHECK ("idempotency_key" = 'CASE_DECISION:' || "decision_id"::text);

-- A case that is being / was executed names its decision; one that was never executed names none.
ALTER TABLE "dispute_cases" ADD CONSTRAINT "dispute_cases_exec_decision_consistent" CHECK (
  ("exec_status" = 'NOT_STARTED' AND "exec_decision_id" IS NULL)
  OR ("exec_status" IN ('EXECUTING', 'BUSINESS_DONE') AND "exec_decision_id" IS NOT NULL)
  OR "exec_status" IN ('EXEC_BLOCKED', 'NEEDS_HUMAN')
);

-- APPEND-ONLY, like every other Slice 1 history table (same trigger function).
CREATE TRIGGER dispute_case_executions_append_only
  BEFORE UPDATE OR DELETE ON "dispute_case_executions"
  FOR EACH ROW EXECUTE FUNCTION dispute_case_reject_mutation();
