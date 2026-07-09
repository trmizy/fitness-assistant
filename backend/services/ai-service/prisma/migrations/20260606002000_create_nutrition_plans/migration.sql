CREATE TABLE IF NOT EXISTS "nutrition_plans" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "goal" TEXT NOT NULL,
  "duration_weeks" INTEGER NOT NULL,
  "meals_per_day" INTEGER NOT NULL,
  "plan" JSONB NOT NULL,
  "status" "PlanStatus" NOT NULL DEFAULT 'QUEUED',
  "job_id" TEXT,
  "fail_reason" TEXT,
  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "nutrition_plans_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "nutrition_plans_user_id_idx" ON "nutrition_plans" ("user_id");
CREATE INDEX IF NOT EXISTS "nutrition_plans_job_id_idx" ON "nutrition_plans" ("job_id");
CREATE INDEX IF NOT EXISTS "nutrition_plans_user_id_status_idx" ON "nutrition_plans" ("user_id", "status");
CREATE INDEX IF NOT EXISTS "nutrition_plans_user_id_archived_at_idx" ON "nutrition_plans" ("user_id", "archived_at");
