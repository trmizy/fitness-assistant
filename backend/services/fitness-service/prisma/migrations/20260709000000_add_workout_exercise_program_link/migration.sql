ALTER TABLE "workout_exercises"
  ADD COLUMN IF NOT EXISTS "program_exercise_id" TEXT;

CREATE INDEX IF NOT EXISTS "workout_exercises_program_exercise_id_idx"
  ON "workout_exercises"("program_exercise_id");

CREATE UNIQUE INDEX IF NOT EXISTS "workout_exercises_workout_program_exercise_unique"
  ON "workout_exercises"("workout_id", "program_exercise_id");
