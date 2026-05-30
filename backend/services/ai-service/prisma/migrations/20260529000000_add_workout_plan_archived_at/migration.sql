-- Soft archive support for AI workout plans.
-- Keeps workout history intact while hiding plans from the default AI Plans view.

ALTER TABLE "workout_plans"
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "workout_plans_user_id_archived_at_idx"
  ON "workout_plans" ("user_id", "archived_at");