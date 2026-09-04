-- CreateEnum
CREATE TYPE "ExerciseType" AS ENUM ('STRENGTH', 'CARDIO', 'MOBILITY', 'STRENGTH_CARDIO', 'STRENGTH_MOBILITY');

-- CreateEnum
CREATE TYPE "EquipmentType" AS ENUM ('BODYWEIGHT', 'BARBELL', 'DUMBBELLS', 'KETTLEBELL', 'MACHINE', 'RESISTANCE_BAND', 'CABLE', 'MEDICINE_BALL', 'FOAM_ROLLER');

-- CreateEnum
CREATE TYPE "BodyPart" AS ENUM ('UPPER_BODY', 'LOWER_BODY', 'CORE', 'FULL_BODY');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('PUSH', 'PULL', 'HOLD', 'STRETCH');

-- CreateTable
CREATE TABLE "exercises" (
    "id" TEXT NOT NULL,
    "exercise_name" TEXT NOT NULL,
    "type_of_activity" "ExerciseType" NOT NULL,
    "type_of_equipment" "EquipmentType" NOT NULL,
    "body_part" "BodyPart" NOT NULL,
    "type" "MovementType" NOT NULL,
    "muscle_groups_activated" TEXT[],
    "instructions" TEXT NOT NULL,
    "video_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workouts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_exercises" (
    "id" TEXT NOT NULL,
    "workout_id" TEXT NOT NULL,
    "exercise_id" TEXT NOT NULL,
    "sets" INTEGER NOT NULL,
    "reps" INTEGER,
    "duration" INTEGER,
    "weight" DOUBLE PRECISION,
    "notes" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workout_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meal_type" TEXT NOT NULL,
    "food_name" TEXT NOT NULL,
    "calories" INTEGER NOT NULL,
    "protein" DOUBLE PRECISION,
    "carbs" DOUBLE PRECISION,
    "fats" DOUBLE PRECISION,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nutrition_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exercises_body_part_type_of_activity_idx" ON "exercises"("body_part", "type_of_activity");

-- CreateIndex
CREATE INDEX "exercises_type_of_equipment_idx" ON "exercises"("type_of_equipment");

-- CreateIndex
CREATE INDEX "workouts_user_id_date_idx" ON "workouts"("user_id", "date");

-- CreateIndex
CREATE INDEX "workout_exercises_workout_id_idx" ON "workout_exercises"("workout_id");

-- CreateIndex
CREATE INDEX "workout_exercises_exercise_id_idx" ON "workout_exercises"("exercise_id");

-- CreateIndex
CREATE INDEX "nutrition_logs_user_id_date_idx" ON "nutrition_logs"("user_id", "date");

-- AddForeignKey
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_workout_id_fkey" FOREIGN KEY ("workout_id") REFERENCES "workouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
