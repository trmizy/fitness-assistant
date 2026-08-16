-- Catch-up migration for schema drift accumulated under `prisma db push` before this service's
-- migration history was the source of truth (same root cause documented at length in
-- user-service's 20260812000000_catch_up_db_push_drift). The nutrition-program tables below
-- were created directly against the dev database and never got a migration file; schema.prisma
-- has always known about them. Written defensively (IF NOT EXISTS / guarded DROP+FK) so this
-- replays as a real builder on a fresh database and as a safe no-op on the already-drifted dev
-- database. Verified both ways before this file was committed.

-- The dev database has this index from an earlier shape of workout_schedules' query pattern;
-- schema.prisma no longer declares it. Dropping is safe — it is redundant with
-- workout_schedules_user_id_date_idx for anything this service still queries by.
DROP INDEX IF EXISTS "workout_schedules_user_status_idx";

-- CreateTable
CREATE TABLE IF NOT EXISTS "nutrition_programs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT,
    "duration_weeks" INTEGER,
    "meals_per_day" INTEGER,
    "daily_calories_target" INTEGER,
    "protein_target_grams" DOUBLE PRECISION,
    "carb_target_grams" DOUBLE PRECISION,
    "fat_target_grams" DOUBLE PRECISION,
    "source_plan_id" TEXT,
    "source_type" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "repeat_enabled" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "nutrition_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "nutrition_program_days" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "day_number" INTEGER NOT NULL,
    "title" TEXT,
    "total_calories" INTEGER,
    "protein_grams" DOUBLE PRECISION,
    "carb_grams" DOUBLE PRECISION,
    "fat_grams" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "nutrition_program_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "nutrition_program_meals" (
    "id" TEXT NOT NULL,
    "day_id" TEXT NOT NULL,
    "meal_type" TEXT NOT NULL,
    "title" TEXT,
    "calories" INTEGER,
    "protein_grams" DOUBLE PRECISION,
    "carb_grams" DOUBLE PRECISION,
    "fat_grams" DOUBLE PRECISION,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "nutrition_program_meals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "nutrition_program_meal_items" (
    "id" TEXT NOT NULL,
    "meal_id" TEXT NOT NULL,
    "food_id" TEXT,
    "custom_food_name" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "unit" TEXT NOT NULL DEFAULT 'g',
    "calories" INTEGER,
    "protein_grams" DOUBLE PRECISION,
    "carb_grams" DOUBLE PRECISION,
    "fat_grams" DOUBLE PRECISION,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "nutrition_program_meal_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "nutrition_meal_completions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "meal_id" TEXT NOT NULL,
    "log_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "percent_consumed" INTEGER NOT NULL DEFAULT 100,
    "consumed_calories" INTEGER,
    "consumed_protein" DOUBLE PRECISION,
    "consumed_carbs" DOUBLE PRECISION,
    "consumed_fat" DOUBLE PRECISION,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "nutrition_meal_completions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "nutrition_programs_user_id_idx" ON "nutrition_programs"("user_id");
CREATE INDEX IF NOT EXISTS "nutrition_programs_user_id_status_idx" ON "nutrition_programs"("user_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "nutrition_programs_user_id_source_plan_id_key" ON "nutrition_programs"("user_id", "source_plan_id");
CREATE INDEX IF NOT EXISTS "nutrition_program_days_program_id_idx" ON "nutrition_program_days"("program_id");
CREATE UNIQUE INDEX IF NOT EXISTS "nutrition_program_days_program_id_day_number_key" ON "nutrition_program_days"("program_id", "day_number");
CREATE INDEX IF NOT EXISTS "nutrition_program_meals_day_id_idx" ON "nutrition_program_meals"("day_id");
CREATE INDEX IF NOT EXISTS "nutrition_program_meal_items_meal_id_idx" ON "nutrition_program_meal_items"("meal_id");
CREATE INDEX IF NOT EXISTS "nutrition_program_meal_items_food_id_idx" ON "nutrition_program_meal_items"("food_id");
CREATE INDEX IF NOT EXISTS "nutrition_meal_completions_user_id_log_date_idx" ON "nutrition_meal_completions"("user_id", "log_date");
CREATE UNIQUE INDEX IF NOT EXISTS "nutrition_meal_completions_user_id_meal_id_log_date_key" ON "nutrition_meal_completions"("user_id", "meal_id", "log_date");

-- AddForeignKey (guarded — Postgres has no `ADD CONSTRAINT IF NOT EXISTS`)
DO $$ BEGIN
  ALTER TABLE "nutrition_program_days" ADD CONSTRAINT "nutrition_program_days_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "nutrition_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "nutrition_program_meals" ADD CONSTRAINT "nutrition_program_meals_day_id_fkey" FOREIGN KEY ("day_id") REFERENCES "nutrition_program_days"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "nutrition_program_meal_items" ADD CONSTRAINT "nutrition_program_meal_items_meal_id_fkey" FOREIGN KEY ("meal_id") REFERENCES "nutrition_program_meals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "nutrition_program_meal_items" ADD CONSTRAINT "nutrition_program_meal_items_food_id_fkey" FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "nutrition_meal_completions" ADD CONSTRAINT "nutrition_meal_completions_meal_id_fkey" FOREIGN KEY ("meal_id") REFERENCES "nutrition_program_meals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
