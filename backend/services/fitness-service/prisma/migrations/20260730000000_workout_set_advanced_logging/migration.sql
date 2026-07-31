-- AlterTable
-- All columns nullable and additive: existing rows read as null ("not
-- classified"), never backfilled/guessed. Safe for `prisma migrate deploy`
-- against a table with existing production rows, and safe for the dev
-- container's `prisma db push --accept-data-loss` entrypoint (no column
-- drops, no type narrowing, no new NOT NULL constraint).
ALTER TABLE "workout_sets"
  ADD COLUMN "set_type" TEXT,
  ADD COLUMN "tempo" TEXT,
  ADD COLUMN "range_of_motion" TEXT,
  ADD COLUMN "side" TEXT,
  ADD COLUMN "pain_score" INTEGER,
  ADD COLUMN "technique_notes" TEXT;
