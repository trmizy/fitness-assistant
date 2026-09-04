CREATE TABLE IF NOT EXISTS "plan_moderation_analyses" (
  "id" TEXT NOT NULL,
  "published_plan_id" TEXT NOT NULL,
  "computed_stats" JSONB NOT NULL,
  "rule_flags" JSONB NOT NULL,
  "similar_listings" JSONB NOT NULL,
  "ai_concerns" JSONB NOT NULL,
  "ai_confidence_score" DOUBLE PRECISION NOT NULL,
  "ai_recommendation" TEXT NOT NULL,
  "explanation_for_admin" TEXT NOT NULL,
  "used_fallback" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "plan_moderation_analyses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "plan_moderation_analyses_published_plan_id_created_at_idx" ON "plan_moderation_analyses"("published_plan_id", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'plan_moderation_analyses_published_plan_id_fkey'
  ) THEN
    ALTER TABLE "plan_moderation_analyses"
      ADD CONSTRAINT "plan_moderation_analyses_published_plan_id_fkey"
      FOREIGN KEY ("published_plan_id") REFERENCES "published_plans"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
