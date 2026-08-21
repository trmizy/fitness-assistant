-- Migration: version NutritionGoal instead of overwriting it in place (real-time body
-- profile / evidence-based adaptive nutrition refactor, spec §24).
--
-- Previously `nutrition_goals` had one row per user (user_id UNIQUE), upserted in place on
-- every change — every prior calorie/macro prescription was lost with no history and no way
-- to answer "why did my calories change" or "what was my target before". This makes it
-- append-only: userId's uniqueness is replaced with the ordinary Postgres pattern of "many
-- rows, at most one flagged ACTIVE" — same convention already used for TrainingCycle's
-- "one ACTIVE cycle per user" partial unique index just above it in this file.

-- `nutrition_goals_user_id_key` is a plain UNIQUE INDEX (created implicitly by Prisma's
-- `@unique`), not a table CONSTRAINT — `DROP CONSTRAINT` does not match it. Must be
-- `DROP INDEX`, or the old full "one row per user_id, period" uniqueness silently survives
-- and rejects the second INSERT this whole migration exists to allow.
DROP INDEX IF EXISTS "nutrition_goals_user_id_key";

ALTER TABLE "nutrition_goals" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "nutrition_goals" ADD COLUMN IF NOT EXISTS "valid_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "nutrition_goals" ADD COLUMN IF NOT EXISTS "superseded_at" TIMESTAMP(3);
ALTER TABLE "nutrition_goals" ADD COLUMN IF NOT EXISTS "reason" TEXT;
ALTER TABLE "nutrition_goals" ADD COLUMN IF NOT EXISTS "triggered_by" TEXT;

-- Backfill: every pre-existing row becomes the user's ACTIVE version, dated from when it was
-- actually created (not "now") so its validFrom reflects reality rather than the moment this
-- migration happened to run.
UPDATE "nutrition_goals" SET "valid_from" = "created_at" WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX IF NOT EXISTS "nutrition_goals_user_id_active_unique"
  ON "nutrition_goals" ("user_id")
  WHERE "status" = 'ACTIVE';

CREATE INDEX IF NOT EXISTS "nutrition_goals_user_id_status_idx" ON "nutrition_goals" ("user_id", "status");
