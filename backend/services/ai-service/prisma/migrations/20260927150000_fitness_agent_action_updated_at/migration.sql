-- X4 event-ordering fix (docs/conversational-intelligence-x4-event-ordering-fix.md), Defect B.
--
-- FitnessAgentAction had no transition timestamp: "created_at" never changes after the row is first written, and
-- "expires_at" is a TTL, not a record of when a status transition actually happened. The confirmation boundary's
-- cross-source precedence rule (which of two independent events — a FitnessAgentAction status, or an
-- AgentWorkflowSession completion — is more recent) therefore compared the WRONG instant for actions: creation
-- time instead of the real confirm/cancel/execute time. A real dismiss (PENDING -> CANCELLED) that happened AFTER
-- a profile confirmation still looked older than that confirmation, because only its (unchanged) creation time was
-- available. This mirrors AgentWorkflowSession's own "updated_at", which already existed and was already correct.
--
-- Backfill existing rows to created_at — the best available signal for rows written before this column existed
-- (better than defaulting every existing row to "now", which would fabricate a false recency for old, already-
-- settled actions). Every future update()/updateMany() call sets this automatically via Prisma's own @updatedAt
-- handling (see schema.prisma) — no application call site needs to change.
ALTER TABLE "fitness_agent_actions" ADD COLUMN "updated_at" TIMESTAMP(3);
UPDATE "fitness_agent_actions" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
ALTER TABLE "fitness_agent_actions" ALTER COLUMN "updated_at" SET NOT NULL;
ALTER TABLE "fitness_agent_actions" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- Defect A: findLatestProfileConfirmation previously fetched only the 5 most recent TERMINAL AgentWorkflowSession
-- rows before filtering for pendingProfileUpdate IS NOT NULL in JS — six newer, unrelated terminal workflows (e.g.
-- abandoned CREATE_WORKOUT_PLAN slot-collections) could fill all 5 slots and hide an older, genuinely completed
-- profile confirmation. The fix moves this filter into a single DB-level query (status IN terminal AND
-- pending_profile_update IS NOT NULL, ORDER BY updated_at DESC LIMIT 1) — no take/window truncation at all. This
-- index supports that query directly.
CREATE INDEX "agent_workflow_sessions_user_id_session_id_status_updated_a_idx"
  ON "agent_workflow_sessions" ("user_id", "session_id", "status", "updated_at");
