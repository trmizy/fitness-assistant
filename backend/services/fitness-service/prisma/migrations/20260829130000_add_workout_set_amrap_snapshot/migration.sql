ALTER TABLE "workout_sets"
ADD COLUMN "is_amrap" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "amrap_min_reps" INTEGER;
