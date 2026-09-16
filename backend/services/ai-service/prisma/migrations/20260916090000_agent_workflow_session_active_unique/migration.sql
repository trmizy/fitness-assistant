-- Codex Conversational AI Coach Evaluation #1, Medium finding "No
-- DB-Enforced Active Workflow Invariant" — AgentWorkflowSession previously
-- had only @@index([userId, sessionId, status]), which does not prevent
-- two concurrent "start workflow" requests from both passing an
-- application-level findFirst-then-create check and producing two
-- non-terminal rows for the same (userId, sessionId).
--
-- Mirrors this repo's own existing precedent for the exact same class of
-- invariant: fitness-service's
-- 20260730020000_training_cycle_active_unique_constraint migration (one
-- ACTIVE TrainingCycle per user). Prisma's schema DSL has no syntax for a
-- WHERE-conditioned unique index, so this is expressed here as raw SQL
-- only (mirrored as a comment in schema.prisma).
--
-- Step 1 — resolve any duplicates that may already exist in this database
-- BEFORE adding the constraint (a duplicate would otherwise make the
-- CREATE UNIQUE INDEX below fail outright). Keep the most recently created
-- non-terminal row per (user_id, session_id) active; cancel the rest. This
-- is additive/non-destructive — no rows are deleted, and CANCELLED is
-- already a real status this table's own application code produces.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, session_id
      ORDER BY created_at DESC
    ) AS rn
  FROM "agent_workflow_sessions"
  WHERE status NOT IN ('COMPLETED', 'CANCELLED', 'EXPIRED')
)
UPDATE "agent_workflow_sessions" t
SET status = 'CANCELLED'
FROM ranked
WHERE t.id = ranked.id
  AND ranked.rn > 1;

-- Step 2 — the actual invariant: at most one non-terminal
-- AgentWorkflowSession row per (user_id, session_id). A second concurrent
-- INSERT trying to create a second active workflow for the same session
-- now fails with a real Postgres unique-violation (P2002 from Prisma's
-- perspective), which workflow-state.repository.ts's create() now catches
-- and turns into a graceful "someone else already started this" response
-- instead of silently allowing two active rows.
CREATE UNIQUE INDEX "agent_workflow_sessions_one_active_per_session"
  ON "agent_workflow_sessions" ("user_id", "session_id")
  WHERE status NOT IN ('COMPLETED', 'CANCELLED', 'EXPIRED');
