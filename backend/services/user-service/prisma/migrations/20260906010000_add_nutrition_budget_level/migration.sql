-- AI Nutrition Cycle Engine (Gymini) — budget-level preference used to bias
-- AI meal-plan generation and deterministic food suggestions toward cheap,
-- common staples (spec §13). Nullable: absence means "not set", treated as
-- NORMAL by every reader — no backfill needed.
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "nutrition_budget_level" TEXT;
