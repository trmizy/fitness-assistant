CREATE TABLE "workout_program_exercise_set_prescriptions" (
  "id" TEXT NOT NULL,
  "program_exercise_id" TEXT NOT NULL,
  "set_number" INTEGER NOT NULL,
  "target_reps" INTEGER,
  "target_weight" DOUBLE PRECISION,
  "target_rpe" DOUBLE PRECISION,
  "target_rir" INTEGER,
  "target_set_type" TEXT,
  "target_tempo" TEXT,
  "target_duration_seconds" INTEGER,
  "target_distance_meters" DOUBLE PRECISION,
  "is_amrap" BOOLEAN NOT NULL DEFAULT false,
  "min_reps" INTEGER,
  "rest_seconds" INTEGER,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "workout_program_exercise_set_prescriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workout_program_exercise_set_prescriptions_unique"
  ON "workout_program_exercise_set_prescriptions"("program_exercise_id", "set_number");

CREATE INDEX "workout_program_exercise_set_prescriptions_program_exercise_id_idx"
  ON "workout_program_exercise_set_prescriptions"("program_exercise_id");

ALTER TABLE "workout_program_exercise_set_prescriptions"
  ADD CONSTRAINT "workout_program_exercise_set_prescriptions_program_exercise_id_fkey"
  FOREIGN KEY ("program_exercise_id")
  REFERENCES "workout_program_exercises"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

INSERT INTO "workout_program_exercise_set_prescriptions" (
  "id",
  "program_exercise_id",
  "set_number",
  "target_reps",
  "target_weight",
  "rest_seconds",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid()::text,
  wpe."id",
  generated_set."set_number",
  wpe."reps",
  wpe."weight",
  wpe."rest_seconds",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "workout_program_exercises" wpe
CROSS JOIN LATERAL generate_series(1, GREATEST(COALESCE(wpe."sets", 1), 1)) AS generated_set("set_number")
ON CONFLICT ("program_exercise_id", "set_number") DO NOTHING;
