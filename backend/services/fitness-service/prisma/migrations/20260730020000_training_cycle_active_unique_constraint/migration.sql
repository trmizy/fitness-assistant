-- Enforces "at most one ACTIVE training cycle per user" at the database
-- level. Previously this was only checked in application code
-- (findFirst-then-create in training-cycle.service.ts), which is a
-- check-then-act race: two near-simultaneous "start cycle" requests could
-- both pass the findFirst check before either commits, producing two
-- ACTIVE cycles for the same user (reproduced via two-tab testing).
--
-- Step 1 — resolve any duplicates that may already exist in this database
-- BEFORE adding the constraint (a duplicate would otherwise make the
-- CREATE UNIQUE INDEX below fail outright). For each user with more than
-- one non-archived ACTIVE cycle, keep the one with the latest start_date
-- ACTIVE and mark the others CANCELLED. This is additive/non-destructive:
-- no rows are deleted, cycleIndex/history/assessments are untouched, and
-- CANCELLED is already a status value anticipated by this schema (see the
-- "Adaptive Training Cycle Evaluation additions" comment on TrainingCycle
-- in schema.prisma). Safe to run even when zero duplicates exist (the
-- CTE below simply selects nothing).
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id
      ORDER BY start_date DESC, created_at DESC
    ) AS rn
  FROM "training_cycles"
  WHERE status = 'ACTIVE' AND archived_at IS NULL
)
UPDATE "training_cycles" t
SET status = 'CANCELLED'
FROM ranked
WHERE t.id = ranked.id
  AND ranked.rn > 1;

-- Step 2 — the actual invariant. A partial unique index (Prisma's schema
-- DSL has no syntax for a WHERE-conditioned unique index, so this is
-- expressed here as raw SQL only, mirrored in schema.prisma as a comment)
-- over (user_id) restricted to non-archived ACTIVE rows: a second
-- concurrent INSERT/UPDATE trying to create a second ACTIVE cycle for the
-- same user now fails with a real Postgres unique-violation (P2002 from
-- Prisma's perspective), which training-cycle.service.ts's startCycle /
-- startDraftCycle now catch and turn into the same clean 409 response
-- instead of a raw 500 — so the DB, not just app logic, guarantees the
-- invariant under concurrency.
CREATE UNIQUE INDEX "training_cycles_one_active_per_user"
  ON "training_cycles" ("user_id")
  WHERE status = 'ACTIVE' AND archived_at IS NULL;
