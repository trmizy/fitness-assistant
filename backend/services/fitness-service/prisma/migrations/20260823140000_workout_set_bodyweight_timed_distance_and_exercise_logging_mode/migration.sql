-- Training-progression P0 (docs/TRAINING_PROGRESSION_ARCHITECTURE.md §6).
-- Purely additive: every new column is nullable (workout_sets) or has a
-- default applied to every existing row (exercises.logging_mode) — no
-- existing row's meaning changes, nothing is backfilled by guessing at
-- data that doesn't exist.

-- WorkoutSet: bodyweight/timed/cardio semantics. `weight` keeps its exact
-- existing meaning (external load); these are new, independent fields.
ALTER TABLE "workout_sets"
  ADD COLUMN "body_weight_at_set_kg" DOUBLE PRECISION,
  ADD COLUMN "duration_seconds" INTEGER,
  ADD COLUMN "distance_meters" DOUBLE PRECISION;

-- Exercise: logging-mode taxonomy, defaulted to the correct value for the
-- overwhelming majority of the existing catalog (weighted exercises).
ALTER TABLE "exercises"
  ADD COLUMN "logging_mode" TEXT NOT NULL DEFAULT 'REPS_LOAD';

-- Backfill heuristic (docs/TRAINING_PROGRESSION_ARCHITECTURE.md §6.2) — run
-- in this specific order so more specific rules override more general ones:
--   1. bodyweight, non-cardio            -> BODYWEIGHT_REPS
--   2. any cardio (bodyweight or not)    -> DISTANCE_TIME (overrides #1)
--   3. HOLD movement type, non-cardio    -> TIME (overrides #1 for planks/holds)
-- Everything else keeps the column default, REPS_LOAD, which is correct for
-- the overwhelming majority of the existing weighted-exercise catalog. This
-- is a heuristic, not guaranteed 100% correct for every one of 883+ existing
-- rows — a follow-up catalog-review pass (ExerciseReviewDecision already
-- exists in this schema for exactly this "flag for human review" workflow)
-- can correct individual misclassifications without another migration.

UPDATE "exercises"
SET "logging_mode" = 'BODYWEIGHT_REPS'
WHERE "type_of_equipment" = 'BODYWEIGHT'
  AND "type_of_activity" NOT IN ('CARDIO', 'STRENGTH_CARDIO');

UPDATE "exercises"
SET "logging_mode" = 'DISTANCE_TIME'
WHERE "type_of_activity" IN ('CARDIO', 'STRENGTH_CARDIO');

UPDATE "exercises"
SET "logging_mode" = 'TIME'
WHERE "type" = 'HOLD'
  AND "type_of_activity" NOT IN ('CARDIO', 'STRENGTH_CARDIO');
