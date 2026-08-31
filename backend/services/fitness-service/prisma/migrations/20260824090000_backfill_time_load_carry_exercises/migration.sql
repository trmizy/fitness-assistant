-- FINAL P0 CLOSURE PASS — loggingMode catalog audit (closure item #7,
-- docs/OPENGYM_FINAL_P0_CLOSURE_REPORT.md "LoggingMode Catalog Audit").
--
-- Finding: the prior backfill migration
-- (20260823140000_workout_set_bodyweight_timed_distance_and_exercise_logging_mode)
-- has NO rule that ever assigns TIME_LOAD — confirmed by direct query
-- (`SELECT logging_mode, count(*) FROM exercises GROUP BY logging_mode`
-- returned zero TIME_LOAD rows out of 1002 real catalog exercises). Real
-- loaded-carry exercises (Farmer Carry, Front Rack Carry, Suitcase Carry —
-- all `type = 'HOLD'` with real external-weight equipment: DUMBBELLS /
-- KETTLEBELL) were left classified as plain TIME, which drops the load
-- dimension entirely: two users could log the same duration with very
-- different weight and it would look identical, and the workout-log UI's
-- TIME mode never shows a weight input at all for them.
--
-- Rule: `type = 'HOLD' AND type_of_equipment != 'BODYWEIGHT'`. Verified
-- against the full real catalog (1002 rows, gymcoach_fitness) before
-- writing this migration: exactly 3 rows match, and they are exactly the 3
-- carry exercises above — no collateral misclassification of any other
-- HOLD-type exercise (all other HOLD rows are genuinely bodyweight
-- static holds/stretches: planks, side bridges, mobility SMR holds, etc.,
-- correctly staying TIME).
--
-- Deliberately NOT touched by this migration: the other 11 rows whose
-- `movement_pattern = 'CARRY'` (Atlas Stones, Sled Push, Sled Drag,
-- Yoke Walk, Farmer's Walk, ...) are almost certainly mistagged at the
-- `type_of_equipment` level (tagged BODYWEIGHT despite genuinely requiring
-- external load — a stone, a loaded sled, a loaded yoke), which is a
-- deeper equipment-taxonomy data-quality issue than a loggingMode backfill
-- rule can safely resolve on its own. Reclassifying their loggingMode
-- without first correcting their equipment tag risks a different kind of
-- wrong answer. Flagged in docs/OPENGYM_FINAL_P0_CLOSURE_REPORT.md as a
-- real, separate, out-of-P0-scope catalog data-quality finding — not
-- silently "fixed" here by guessing.
UPDATE "exercises"
SET "logging_mode" = 'TIME_LOAD'
WHERE "type" = 'HOLD'
  AND "type_of_equipment" != 'BODYWEIGHT';
