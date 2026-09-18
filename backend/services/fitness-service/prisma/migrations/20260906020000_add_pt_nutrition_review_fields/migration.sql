-- Phase 2 (PT nutrition workflow) — ownership/traceability for a PT's
-- Approve/Modify/Reject action on a client's AI nutrition recommendation.
-- All additive, all nullable, zero backfill needed for existing rows.

ALTER TABLE "nutrition_goals" ADD COLUMN IF NOT EXISTS "created_by_user_id" TEXT;
ALTER TABLE "nutrition_goals" ADD COLUMN IF NOT EXISTS "previous_goal_id" TEXT;
ALTER TABLE "nutrition_goals" ADD COLUMN IF NOT EXISTS "source_assessment_id" TEXT;

ALTER TABLE "cycle_assessments" ADD COLUMN IF NOT EXISTS "nutrition_reviewed_by_user_id" TEXT;
ALTER TABLE "cycle_assessments" ADD COLUMN IF NOT EXISTS "nutrition_reviewed_by_role" TEXT;
ALTER TABLE "cycle_assessments" ADD COLUMN IF NOT EXISTS "nutrition_pt_note" TEXT;
