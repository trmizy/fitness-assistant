-- TrainingCycle v2: replaces outcome-only classification (ACHIEVED/PARTIAL/
-- NOT_ACHIEVED) with a decision model (KEEP/ADJUST/NEW_PLAN) driven by
-- rolling metrics + deterministic pre-classification + AI proposal.
-- Existing rows are dropped in the same release cycle this migration ships
-- in dev (no production data existed under the old shape).

-- DropColumns (old outcome-only fields, superseded by summary/decision/aiAnalysis)
ALTER TABLE "training_cycles" DROP COLUMN IF EXISTS "source_plan_id";
ALTER TABLE "training_cycles" DROP COLUMN IF EXISTS "goal_at_start";
ALTER TABLE "training_cycles" DROP COLUMN IF EXISTS "target_weight_at_start";
ALTER TABLE "training_cycles" DROP COLUMN IF EXISTS "start_weight_kg";
ALTER TABLE "training_cycles" DROP COLUMN IF EXISTS "start_body_fat_pct";
ALTER TABLE "training_cycles" DROP COLUMN IF EXISTS "start_muscle_mass_kg";
ALTER TABLE "training_cycles" DROP COLUMN IF EXISTS "start_inbody_date";
ALTER TABLE "training_cycles" DROP COLUMN IF EXISTS "end_weight_kg";
ALTER TABLE "training_cycles" DROP COLUMN IF EXISTS "end_body_fat_pct";
ALTER TABLE "training_cycles" DROP COLUMN IF EXISTS "end_muscle_mass_kg";
ALTER TABLE "training_cycles" DROP COLUMN IF EXISTS "end_inbody_date";
ALTER TABLE "training_cycles" DROP COLUMN IF EXISTS "adherence_percent";
ALTER TABLE "training_cycles" DROP COLUMN IF EXISTS "outcome";
ALTER TABLE "training_cycles" DROP COLUMN IF EXISTS "outcome_reason";

-- Clear any rows that predate this migration — old shape is not meaningfully
-- convertible to the new decision model (dev-only data, see note above).
DELETE FROM "training_cycles";

-- AddColumns
ALTER TABLE "training_cycles" ADD COLUMN "plan_id" TEXT;
ALTER TABLE "training_cycles" ADD COLUMN "cycle_index" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "training_cycles" ADD COLUMN "duration_days" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "training_cycles" ADD COLUMN "goal" TEXT;
ALTER TABLE "training_cycles" ADD COLUMN "start_inbody_id" TEXT;
ALTER TABLE "training_cycles" ADD COLUMN "end_inbody_id" TEXT;
ALTER TABLE "training_cycles" ADD COLUMN "summary" JSONB;
ALTER TABLE "training_cycles" ADD COLUMN "low_confidence" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "training_cycles" ADD COLUMN "decision" TEXT;
ALTER TABLE "training_cycles" ADD COLUMN "ai_analysis" JSONB;
ALTER TABLE "training_cycles" ADD COLUMN "next_plan_id" TEXT;

-- AlterColumn: end_date is now always set (planned close = startDate + durationDays)
ALTER TABLE "training_cycles" ALTER COLUMN "end_date" SET NOT NULL;
