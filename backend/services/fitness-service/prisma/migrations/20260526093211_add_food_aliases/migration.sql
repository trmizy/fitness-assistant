-- AlterTable
ALTER TABLE "nutrition_goals" ALTER COLUMN "calories" SET DEFAULT 2000,
ALTER COLUMN "protein" SET DEFAULT 150,
ALTER COLUMN "carbs" SET DEFAULT 200,
ALTER COLUMN "fat" SET DEFAULT 65;

-- CreateTable
CREATE TABLE "foods" (
    "id" TEXT NOT NULL,
    "fdc_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "calories" DOUBLE PRECISION NOT NULL,
    "protein" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "carbs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fats" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL,
    "image_url" TEXT,

    CONSTRAINT "foods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_aliases" (
    "id" TEXT NOT NULL,
    "food_id" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "alias_normalized" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'vi',
    "source" TEXT DEFAULT 'manual_seed',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "food_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "body_metrics" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "weight" DOUBLE PRECISION,
    "body_fat" DOUBLE PRECISION,
    "muscle_mass" DOUBLE PRECISION,
    "body_water" DOUBLE PRECISION,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "body_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_programs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workout_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_program_days" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "day_number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "duration" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workout_program_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_program_exercises" (
    "id" TEXT NOT NULL,
    "program_day_id" TEXT NOT NULL,
    "exercise_id" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "sets" INTEGER,
    "reps" INTEGER,
    "weight" DOUBLE PRECISION,
    "duration" INTEGER,
    "rest_seconds" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workout_program_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_schedules" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "program_day_id" TEXT,
    "workout_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workout_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "foods_fdc_id_key" ON "foods"("fdc_id");

-- CreateIndex
CREATE INDEX "foods_name_idx" ON "foods"("name");

-- CreateIndex
CREATE INDEX "food_aliases_food_id_idx" ON "food_aliases"("food_id");

-- CreateIndex
CREATE INDEX "food_aliases_alias_idx" ON "food_aliases"("alias");

-- CreateIndex
CREATE INDEX "food_aliases_alias_normalized_idx" ON "food_aliases"("alias_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "food_aliases_food_id_alias_language_key" ON "food_aliases"("food_id", "alias", "language");

-- CreateIndex
CREATE UNIQUE INDEX "food_aliases_food_id_alias_normalized_language_key" ON "food_aliases"("food_id", "alias_normalized", "language");

-- CreateIndex
CREATE INDEX "body_metrics_user_id_date_idx" ON "body_metrics"("user_id", "date");

-- CreateIndex
CREATE INDEX "workout_programs_user_id_idx" ON "workout_programs"("user_id");

-- CreateIndex
CREATE INDEX "workout_program_days_program_id_idx" ON "workout_program_days"("program_id");

-- CreateIndex
CREATE UNIQUE INDEX "workout_program_days_program_id_day_number_key" ON "workout_program_days"("program_id", "day_number");

-- CreateIndex
CREATE INDEX "workout_program_exercises_program_day_id_idx" ON "workout_program_exercises"("program_day_id");

-- CreateIndex
CREATE INDEX "workout_program_exercises_exercise_id_idx" ON "workout_program_exercises"("exercise_id");

-- CreateIndex
CREATE INDEX "workout_schedules_user_id_date_idx" ON "workout_schedules"("user_id", "date");

-- CreateIndex
CREATE INDEX "workout_schedules_program_day_id_idx" ON "workout_schedules"("program_day_id");

-- CreateIndex
CREATE INDEX "workout_schedules_workout_id_idx" ON "workout_schedules"("workout_id");

-- CreateIndex
CREATE UNIQUE INDEX "workout_schedules_user_id_date_key" ON "workout_schedules"("user_id", "date");

-- AddForeignKey
ALTER TABLE "food_aliases" ADD CONSTRAINT "food_aliases_food_id_fkey" FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_program_days" ADD CONSTRAINT "workout_program_days_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "workout_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_program_exercises" ADD CONSTRAINT "workout_program_exercises_program_day_id_fkey" FOREIGN KEY ("program_day_id") REFERENCES "workout_program_days"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_program_exercises" ADD CONSTRAINT "workout_program_exercises_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_schedules" ADD CONSTRAINT "workout_schedules_program_day_id_fkey" FOREIGN KEY ("program_day_id") REFERENCES "workout_program_days"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_schedules" ADD CONSTRAINT "workout_schedules_workout_id_fkey" FOREIGN KEY ("workout_id") REFERENCES "workouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
