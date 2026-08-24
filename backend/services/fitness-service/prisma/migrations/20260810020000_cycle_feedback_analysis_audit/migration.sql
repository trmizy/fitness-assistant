CREATE TABLE IF NOT EXISTS "cycle_feedback_analysis_audits" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "cycle_id" TEXT NOT NULL,

  "cycle_feedback_summary_snapshot" JSONB NOT NULL,

  "feedback_interpretation" TEXT NOT NULL,
  "sentiment" TEXT NOT NULL,
  "complaint_validity" TEXT NOT NULL,
  "complaint_categories" JSONB NOT NULL,
  "suggested_improvement_areas" JSONB NOT NULL,
  "risk_flags" JSONB NOT NULL,
  "recommended_decision_influence" TEXT NOT NULL,
  "explanation_for_user" TEXT NOT NULL,
  "explanation_for_coach" TEXT NOT NULL,

  "ai_fallback" BOOLEAN NOT NULL DEFAULT false,

  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "cycle_feedback_analysis_audits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "cycle_feedback_analysis_audits_user_id_cycle_id_idx" ON "cycle_feedback_analysis_audits"("user_id", "cycle_id");
CREATE INDEX IF NOT EXISTS "cycle_feedback_analysis_audits_cycle_id_created_at_idx" ON "cycle_feedback_analysis_audits"("cycle_id", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'cycle_feedback_analysis_audits_cycle_id_fkey'
  ) THEN
    ALTER TABLE "cycle_feedback_analysis_audits"
      ADD CONSTRAINT "cycle_feedback_analysis_audits_cycle_id_fkey"
      FOREIGN KEY ("cycle_id") REFERENCES "training_cycles"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
