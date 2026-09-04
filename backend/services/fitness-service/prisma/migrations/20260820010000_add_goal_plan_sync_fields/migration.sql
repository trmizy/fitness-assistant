-- Migration: Goal <-> Plan consistency support fields
--
-- Root-cause fix (nutrition audit finding, câu 6 in
-- docs/audit/nutrition-ai-current-flow-audit.md): NutritionGoal and
-- NutritionProgram are two independently-versioned models with zero
-- synchronization between them — changing a goal never touches the active
-- program, and there was no way to detect "this plan was built from an
-- older goal version" at all. This migration is purely additive: two new
-- nullable/defaulted columns, no data loss, no backfill needed for
-- NutritionProgram.sourceGoalId (existing rows correctly stay NULL —
-- "unknown source goal", not fabricated), and NutritionGoal.goalMode
-- backfills to the existing implicit behavior ('RECOMMENDED') since every
-- goal created before this column existed came from the AI-calculated
-- flow.

ALTER TABLE "nutrition_programs" ADD COLUMN IF NOT EXISTS "source_goal_id" TEXT;

ALTER TABLE "nutrition_goals" ADD COLUMN IF NOT EXISTS "goal_mode" TEXT NOT NULL DEFAULT 'RECOMMENDED';
