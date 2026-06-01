ALTER TABLE "workout_schedules"
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN IF NOT EXISTS "progress_percent" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "started_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "total_exercises" INTEGER,
  ADD COLUMN IF NOT EXISTS "completed_exercises" INTEGER,
  ADD COLUMN IF NOT EXISTS "total_sets" INTEGER,
  ADD COLUMN IF NOT EXISTS "completed_sets" INTEGER,
  ADD COLUMN IF NOT EXISTS "duration_seconds" INTEGER,
  ADD COLUMN IF NOT EXISTS "calories_estimate" INTEGER;

UPDATE "workout_schedules"
SET
  "status" = CASE WHEN "workout_id" IS NOT NULL THEN 'COMPLETED' ELSE "status" END,
  "progress_percent" = CASE WHEN "workout_id" IS NOT NULL THEN 100 ELSE "progress_percent" END,
  "completed_at" = CASE WHEN "workout_id" IS NOT NULL AND "completed_at" IS NULL THEN "updated_at" ELSE "completed_at" END
WHERE "workout_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "workout_schedules_user_status_idx"
  ON "workout_schedules"("user_id", "status");
