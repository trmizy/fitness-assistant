-- Migration: Phase 2 — Adaptive Nutrition Decision Engine columns on cycle_assessments.
--
-- Additive only. Reuses the existing cycle_assessments/recommendation_audits tables
-- (both already generic enough) rather than creating new ones — see
-- docs/body-state-and-adaptive-planning.md.
ALTER TABLE "cycle_assessments" ADD COLUMN IF NOT EXISTS "nutrition_decision" TEXT;
ALTER TABLE "cycle_assessments" ADD COLUMN IF NOT EXISTS "nutrition_confidence" TEXT;
ALTER TABLE "cycle_assessments" ADD COLUMN IF NOT EXISTS "nutrition_signals" JSONB;
ALTER TABLE "cycle_assessments" ADD COLUMN IF NOT EXISTS "nutrition_proposed_changes" JSONB;
ALTER TABLE "cycle_assessments" ADD COLUMN IF NOT EXISTS "nutrition_reason_codes" JSONB;
ALTER TABLE "cycle_assessments" ADD COLUMN IF NOT EXISTS "nutrition_evidence_ids" JSONB;
ALTER TABLE "cycle_assessments" ADD COLUMN IF NOT EXISTS "nutrition_requires_confirmation" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "cycle_assessments" ADD COLUMN IF NOT EXISTS "nutrition_user_decision" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "cycle_assessments" ADD COLUMN IF NOT EXISTS "nutrition_reviewed_at" TIMESTAMP(3);
ALTER TABLE "cycle_assessments" ADD COLUMN IF NOT EXISTS "applied_nutrition_goal_id" TEXT;
