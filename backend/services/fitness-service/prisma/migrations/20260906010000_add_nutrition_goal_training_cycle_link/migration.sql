-- AI Nutrition Cycle Engine (Gymini) — link a NutritionGoal (the versioned
-- calorie/macro prescription) to the TrainingCycle it was generated for or
-- alongside, so "which cycle produced this target" is answerable without
-- inferring it from timestamps. Nullable: a MANUAL/PT edit made outside any
-- cycle context legitimately has no cycle to link to.
ALTER TABLE "nutrition_goals" ADD COLUMN IF NOT EXISTS "training_cycle_id" TEXT;

CREATE INDEX IF NOT EXISTS "nutrition_goals_training_cycle_id_idx"
  ON "nutrition_goals" ("training_cycle_id");
