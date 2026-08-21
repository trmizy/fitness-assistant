-- Migration: Phase 2 — persist ai-service's nutrition explanation (headline/explanation),
-- distinct from the deterministic nutritionDecision the engine already computed.
ALTER TABLE "cycle_assessments" ADD COLUMN IF NOT EXISTS "nutrition_ai_headline" TEXT;
ALTER TABLE "cycle_assessments" ADD COLUMN IF NOT EXISTS "nutrition_ai_explanation" TEXT;
