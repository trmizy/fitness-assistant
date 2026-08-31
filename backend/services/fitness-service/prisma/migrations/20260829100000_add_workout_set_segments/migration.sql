CREATE TABLE "workout_set_segments" (
    "id" TEXT NOT NULL,
    "workout_set_id" TEXT NOT NULL,
    "segment_number" INTEGER NOT NULL,
    "technique" TEXT NOT NULL,
    "reps" INTEGER NOT NULL,
    "weight" DOUBLE PRECISION,
    "rpe" DOUBLE PRECISION,
    "rir" INTEGER,
    "rest_before_seconds" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workout_set_segments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workout_set_segments_workout_set_id_segment_number_key"
ON "workout_set_segments"("workout_set_id", "segment_number");

CREATE INDEX "workout_set_segments_workout_set_id_idx"
ON "workout_set_segments"("workout_set_id");

ALTER TABLE "workout_set_segments"
ADD CONSTRAINT "workout_set_segments_workout_set_id_fkey"
FOREIGN KEY ("workout_set_id") REFERENCES "workout_sets"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
