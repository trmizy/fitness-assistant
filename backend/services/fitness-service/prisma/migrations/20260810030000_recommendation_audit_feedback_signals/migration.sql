ALTER TABLE "recommendation_audits"
  ADD COLUMN IF NOT EXISTS "feedback_signals_used" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "feedback_summary_snapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "ai_feedback_analysis_id" TEXT,
  ADD COLUMN IF NOT EXISTS "final_decision_reason_codes" JSONB,
  ADD COLUMN IF NOT EXISTS "complaint_validity" TEXT,
  ADD COLUMN IF NOT EXISTS "decision_influence_from_feedback" TEXT;
