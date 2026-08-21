ALTER TABLE "published_plans"
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "previous_version_id" TEXT,
  ADD COLUMN IF NOT EXISTS "changelog" TEXT,
  ADD COLUMN IF NOT EXISTS "improvement_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "approved_by" TEXT,
  ADD COLUMN IF NOT EXISTS "quality_score" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "quality_score_computed_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "published_plans_previous_version_id_idx" ON "published_plans"("previous_version_id");

ALTER TABLE "plan_reviews"
  ADD COLUMN IF NOT EXISTS "goal_fit" INTEGER,
  ADD COLUMN IF NOT EXISTS "difficulty_fit" TEXT,
  ADD COLUMN IF NOT EXISTS "enjoyment" INTEGER,
  ADD COLUMN IF NOT EXISTS "clarity" INTEGER,
  ADD COLUMN IF NOT EXISTS "equipment_fit" INTEGER,
  ADD COLUMN IF NOT EXISTS "time_fit" INTEGER,
  ADD COLUMN IF NOT EXISTS "results_perception" TEXT,
  ADD COLUMN IF NOT EXISTS "would_use_again" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "complaint_tags" JSONB,
  ADD COLUMN IF NOT EXISTS "free_text" TEXT;

CREATE TABLE IF NOT EXISTS "plan_improvement_suggestions" (
  "id" TEXT NOT NULL,
  "published_plan_id" TEXT NOT NULL,
  "based_on_review_count" INTEGER NOT NULL,
  "quality_score_snapshot" DOUBLE PRECISION,
  "suggestions" JSONB NOT NULL,
  "common_complaints" JSONB NOT NULL,
  "summary" TEXT NOT NULL,
  "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "plan_improvement_suggestions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "plan_improvement_suggestions_published_plan_id_generated_at_idx" ON "plan_improvement_suggestions"("published_plan_id", "generated_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'plan_improvement_suggestions_published_plan_id_fkey'
  ) THEN
    ALTER TABLE "plan_improvement_suggestions"
      ADD CONSTRAINT "plan_improvement_suggestions_published_plan_id_fkey"
      FOREIGN KEY ("published_plan_id") REFERENCES "published_plans"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "plan_adoptions" (
  "id" TEXT NOT NULL,
  "published_plan_id" TEXT NOT NULL,
  "adopter_id" TEXT NOT NULL,
  "access_basis" TEXT NOT NULL,
  "purchase_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "plan_adoptions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "plan_adoptions_published_plan_id_adopter_id_idx" ON "plan_adoptions"("published_plan_id", "adopter_id");
CREATE INDEX IF NOT EXISTS "plan_adoptions_adopter_id_created_at_idx" ON "plan_adoptions"("adopter_id", "created_at");
