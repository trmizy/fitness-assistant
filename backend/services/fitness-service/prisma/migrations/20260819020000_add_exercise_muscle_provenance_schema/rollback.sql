-- Rollback for 20260819020000_add_exercise_muscle_provenance_schema.
--
-- NOT auto-applied by any tooling — this is a manual, reviewed action per
-- rule #19 ("phải có rollback strategy") and rule #7 ("không chạy
-- migration phá hủy trên production" — even running THIS rollback should
-- go through the same environment-check discipline as any other mutation).
--
-- Safe by construction: every table this drops was created BY the
-- forward migration in this same directory and (at the time this
-- rollback is written) holds no data except the 29 hand-curated muscle
-- taxonomy rows and whatever exercise_name_snapshot backfill ran — no
-- user-generated history lives in any of these new tables. If Gate 5+
-- import work has since populated exercise_sources/exercise_aliases/
-- exercise_muscles/food_sources/recipes with real imported data, DO NOT
-- run this rollback without first exporting/backing up that data — it is
-- gone once these DROP statements run.
--
-- Run with: psql "$DATABASE_URL" -f rollback.sql
-- (or the equivalent inside the fitness-service container)

DROP TABLE IF EXISTS "recipe_ingredients";
DROP TABLE IF EXISTS "recipes";
DROP TABLE IF EXISTS "food_sources";
DROP TABLE IF EXISTS "exercise_muscles";
DROP TABLE IF EXISTS "muscles";
DROP TABLE IF EXISTS "exercise_aliases";
DROP TABLE IF EXISTS "exercise_sources";

-- exercise_name_snapshot is additive/nullable — dropping it cannot violate
-- any constraint on existing data, but it DOES discard the snapshot
-- backfill (which is recoverable by re-running the forward migration's
-- UPDATE, as long as the live Exercise rows it joined against are
-- unchanged).
ALTER TABLE "workout_exercises" DROP COLUMN IF EXISTS "exercise_name_snapshot";
