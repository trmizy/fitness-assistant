-- Add AI plan source tracking to workout programs and schedules
ALTER TABLE "workout_programs"
ADD COLUMN "source_plan_id" TEXT,
ADD COLUMN "source_type" TEXT,
ADD COLUMN "ai_plan_version" INTEGER;

ALTER TABLE "workout_schedules"
ADD COLUMN "source_plan_id" TEXT,
ADD COLUMN "source_type" TEXT;

CREATE INDEX "workout_programs_user_id_source_plan_id_idx" ON "workout_programs"("user_id", "source_plan_id");
CREATE UNIQUE INDEX "workout_programs_user_id_source_plan_id_key" ON "workout_programs"("user_id", "source_plan_id");
CREATE INDEX "workout_schedules_user_id_source_plan_id_idx" ON "workout_schedules"("user_id", "source_plan_id");