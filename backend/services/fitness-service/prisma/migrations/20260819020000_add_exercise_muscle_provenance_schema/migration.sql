-- Gate 4 of the exercise/anatomy/nutrition data-expansion roadmap.
-- ADDITIVE ONLY: every statement below either creates a brand-new table or
-- adds a nullable/defaulted column to an existing table. No existing
-- column is altered or dropped, no existing row's primary key changes, no
-- existing foreign key's ON DELETE behavior changes. Every CREATE/ALTER
-- uses IF NOT EXISTS so this migration is safe to re-run.
--
-- See docs/audit/exercise-nutrition-data-impact-map.md for the full
-- impact analysis this schema was designed against, and
-- reports/data/duplicate-candidate-report.md for the Gate 3 matching
-- these tables are meant to support (ExerciseAlias is the mechanism that
-- report's EXACT_CROSS_SOURCE decisions would actually use).
--
-- Rollback: see the companion rollback.sql in this same migration
-- directory — every CREATE TABLE has a matching DROP TABLE IF EXISTS, and
-- the ALTER TABLE ADD COLUMN has a matching DROP COLUMN IF EXISTS. Because
-- every new column is nullable/defaulted, rolling back never risks a
-- NOT-NULL constraint violation on existing data.

-- ── Exercise provenance ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "exercise_sources" (
  "id" TEXT NOT NULL,
  "exercise_id" TEXT NOT NULL,
  "source_name" TEXT NOT NULL,
  "external_id" TEXT,
  "source_url" TEXT,
  "data_license" TEXT,
  "media_license" TEXT,
  "source_version" TEXT,
  "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "raw_hash" TEXT,
  CONSTRAINT "exercise_sources_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "exercise_sources_exercise_id_source_name_external_id_key"
  ON "exercise_sources"("exercise_id", "source_name", "external_id");
CREATE INDEX IF NOT EXISTS "exercise_sources_exercise_id_idx" ON "exercise_sources"("exercise_id");
CREATE INDEX IF NOT EXISTS "exercise_sources_source_name_idx" ON "exercise_sources"("source_name");

DO $$ BEGIN
  ALTER TABLE "exercise_sources" ADD CONSTRAINT "exercise_sources_exercise_id_fkey"
    FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Exercise localization / aliases ──────────────────────────────────
CREATE TABLE IF NOT EXISTS "exercise_aliases" (
  "id" TEXT NOT NULL,
  "exercise_id" TEXT NOT NULL,
  "language" TEXT NOT NULL,
  "alias" TEXT NOT NULL,
  "alias_normalized" TEXT NOT NULL,
  "alias_type" TEXT NOT NULL DEFAULT 'localized_name',
  "source" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exercise_aliases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "exercise_aliases_exercise_id_language_alias_normalized_key"
  ON "exercise_aliases"("exercise_id", "language", "alias_normalized");
CREATE INDEX IF NOT EXISTS "exercise_aliases_exercise_id_idx" ON "exercise_aliases"("exercise_id");
CREATE INDEX IF NOT EXISTS "exercise_aliases_alias_normalized_idx" ON "exercise_aliases"("alias_normalized");

DO $$ BEGIN
  ALTER TABLE "exercise_aliases" ADD CONSTRAINT "exercise_aliases_exercise_id_fkey"
    FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Canonical muscle taxonomy ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "muscles" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name_vi" TEXT NOT NULL,
  "name_en" TEXT,
  "anatomy_region" TEXT,
  "parent_muscle_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "muscles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "muscles_code_key" ON "muscles"("code");

DO $$ BEGIN
  ALTER TABLE "muscles" ADD CONSTRAINT "muscles_parent_muscle_id_fkey"
    FOREIGN KEY ("parent_muscle_id") REFERENCES "muscles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Exercise <-> Muscle mapping (primary/secondary) ──────────────────
CREATE TABLE IF NOT EXISTS "exercise_muscles" (
  "id" TEXT NOT NULL,
  "exercise_id" TEXT NOT NULL,
  "muscle_id" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "source" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exercise_muscles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "exercise_muscles_exercise_id_muscle_id_role_key"
  ON "exercise_muscles"("exercise_id", "muscle_id", "role");
CREATE INDEX IF NOT EXISTS "exercise_muscles_exercise_id_idx" ON "exercise_muscles"("exercise_id");
CREATE INDEX IF NOT EXISTS "exercise_muscles_muscle_id_idx" ON "exercise_muscles"("muscle_id");

DO $$ BEGIN
  ALTER TABLE "exercise_muscles" ADD CONSTRAINT "exercise_muscles_exercise_id_fkey"
    FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "exercise_muscles" ADD CONSTRAINT "exercise_muscles_muscle_id_fkey"
    FOREIGN KEY ("muscle_id") REFERENCES "muscles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Food provenance (future multi-source foods) ──────────────────────
CREATE TABLE IF NOT EXISTS "food_sources" (
  "id" TEXT NOT NULL,
  "food_id" TEXT NOT NULL,
  "source_name" TEXT NOT NULL,
  "external_id" TEXT,
  "source_url" TEXT,
  "license" TEXT,
  "source_version" TEXT,
  "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confidence" DOUBLE PRECISION,
  CONSTRAINT "food_sources_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "food_sources_food_id_source_name_external_id_key"
  ON "food_sources"("food_id", "source_name", "external_id");
CREATE INDEX IF NOT EXISTS "food_sources_food_id_idx" ON "food_sources"("food_id");

DO $$ BEGIN
  ALTER TABLE "food_sources" ADD CONSTRAINT "food_sources_food_id_fkey"
    FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Recipes (Phase 3 — Vietnamese dishes composed from real ingredients) ──
CREATE TABLE IF NOT EXISTS "recipes" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "name_vi" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "yield_servings" DOUBLE PRECISION NOT NULL,
  "preparation_state" TEXT,
  "source" TEXT,
  "status" TEXT NOT NULL DEFAULT 'STAGING',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "recipes_status_idx" ON "recipes"("status");

CREATE TABLE IF NOT EXISTS "recipe_ingredients" (
  "id" TEXT NOT NULL,
  "recipe_id" TEXT NOT NULL,
  "food_id" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "unit" TEXT NOT NULL DEFAULT 'g',
  "grams_equivalent" DOUBLE PRECISION NOT NULL,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recipe_ingredients_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "recipe_ingredients_recipe_id_idx" ON "recipe_ingredients"("recipe_id");
CREATE INDEX IF NOT EXISTS "recipe_ingredients_food_id_idx" ON "recipe_ingredients"("food_id");

DO $$ BEGIN
  ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipe_id_fkey"
    FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_food_id_fkey"
    FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── History-protection snapshot on WorkoutExercise ───────────────────
-- Nullable, additive. Backfilled below from the CURRENT exercise name —
-- the best available approximation for rows that predate this column
-- (their real historical name at logging time was never captured before
-- now). Going forward, application code should populate this at write
-- time with the name as it is THEN, so a later Exercise rename never
-- retroactively changes what a past workout log displays.
ALTER TABLE "workout_exercises" ADD COLUMN IF NOT EXISTS "exercise_name_snapshot" TEXT;

UPDATE "workout_exercises" we
SET "exercise_name_snapshot" = e."exercise_name"
FROM "exercises" e
WHERE we."exercise_id" = e."id" AND we."exercise_name_snapshot" IS NULL;

-- ── Seed the canonical muscle taxonomy from the already-curated,
-- original (no external-license question) data/catalog/taxonomy/
-- ref_muscles.csv — 29 rows, hand-authored for this project. This is
-- NOT a bulk external import (Gate 5 territory); it's populating a
-- brand-new, previously-empty table from content this repo already owns
-- and that Gate 0 confirmed has no license question at all.
INSERT INTO "muscles" ("id", "code", "name_vi", "created_at") VALUES
  (gen_random_uuid()::text, 'chest', 'Ngực', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'upper_chest', 'Ngực trên', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'mid_chest', 'Ngực giữa', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'lower_chest', 'Ngực dưới', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'front_delts', 'Vai trước', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'side_delts', 'Vai giữa', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'rear_delts', 'Vai sau', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'triceps', 'Tay sau', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'biceps', 'Tay trước', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'forearms', 'Cẳng tay', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'lats', 'Xô', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'upper_back', 'Lưng trên', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'mid_back', 'Lưng giữa', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'traps', 'Cầu vai', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'spinal_erectors', 'Cơ dựng sống', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'abs', 'Bụng', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'obliques', 'Xiên bụng', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'transverse_abs', 'Core sâu', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'glutes', 'Mông', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'quads', 'Đùi trước', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'hamstrings', 'Đùi sau', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'adductors', 'Khép đùi', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'abductors', 'Dang đùi', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'calves', 'Bắp chân', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'hip_flexors', 'Gập hông', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'rotator_cuff', 'Chóp xoay', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'cardiovascular', 'Tim mạch', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'mobility', 'Linh hoạt', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'core', 'Core', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Backfill anatomy_region for the seeded rows — a simple, deterministic
-- classification (not a guess about any individual exercise, just a
-- coarse grouping of the muscle itself for legend/filtering).
UPDATE "muscles" SET "anatomy_region" = 'upper_body' WHERE "code" IN
  ('chest','upper_chest','mid_chest','lower_chest','front_delts','side_delts','rear_delts',
   'triceps','biceps','forearms','lats','upper_back','mid_back','traps','rotator_cuff')
  AND "anatomy_region" IS NULL;
UPDATE "muscles" SET "anatomy_region" = 'lower_body' WHERE "code" IN
  ('glutes','quads','hamstrings','adductors','abductors','calves','hip_flexors')
  AND "anatomy_region" IS NULL;
UPDATE "muscles" SET "anatomy_region" = 'core' WHERE "code" IN
  ('abs','obliques','transverse_abs','spinal_erectors','core')
  AND "anatomy_region" IS NULL;
UPDATE "muscles" SET "anatomy_region" = 'full_body' WHERE "code" IN
  ('cardiovascular','mobility')
  AND "anatomy_region" IS NULL;
