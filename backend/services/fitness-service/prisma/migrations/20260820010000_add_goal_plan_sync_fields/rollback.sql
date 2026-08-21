-- Rollback for 20260820010000_add_goal_plan_sync_fields
-- Purely additive migration — dropping these columns loses no other data.

ALTER TABLE "nutrition_programs" DROP COLUMN IF EXISTS "source_goal_id";
ALTER TABLE "nutrition_goals" DROP COLUMN IF EXISTS "goal_mode";
