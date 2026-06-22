-- Add metadata used to synchronize profile goals with active workout programs.
-- Safe for existing local databases where some columns may already exist.
ALTER TABLE "workout_programs"
ADD COLUMN IF NOT EXISTS "goal" TEXT,
ADD COLUMN IF NOT EXISTS "duration_weeks" INTEGER,
ADD COLUMN IF NOT EXISTS "days_per_week" INTEGER,
ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS "workout_programs_user_id_status_idx"
ON "workout_programs"("user_id", "status");
