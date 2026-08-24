-- Gym-onboarding project: normalized equipment catalog + exercise/user
-- equipment relations. Purely additive — no existing table/column is
-- touched, so this is safe against production data (see
-- docs/... onboarding audit notes for the rationale).

ALTER TABLE "exercises"
  ADD COLUMN IF NOT EXISTS "difficulty_level" TEXT;

CREATE TABLE IF NOT EXISTS "equipment" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "aliases" TEXT[] NOT NULL DEFAULT '{}',
  "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "equipment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "equipment_slug_key" ON "equipment"("slug");
CREATE INDEX IF NOT EXISTS "equipment_category_idx" ON "equipment"("category");

CREATE TABLE IF NOT EXISTS "exercise_equipment" (
  "id" TEXT NOT NULL,
  "exercise_id" TEXT NOT NULL,
  "equipment_id" TEXT NOT NULL,
  "requirement_type" TEXT NOT NULL DEFAULT 'REQUIRED',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exercise_equipment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "exercise_equipment_exercise_id_equipment_id_key"
  ON "exercise_equipment"("exercise_id", "equipment_id");
CREATE INDEX IF NOT EXISTS "exercise_equipment_exercise_id_idx" ON "exercise_equipment"("exercise_id");
CREATE INDEX IF NOT EXISTS "exercise_equipment_equipment_id_idx" ON "exercise_equipment"("equipment_id");

DO $$ BEGIN
  ALTER TABLE "exercise_equipment"
    ADD CONSTRAINT "exercise_equipment_exercise_id_fkey"
    FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "exercise_equipment"
    ADD CONSTRAINT "exercise_equipment_equipment_id_fkey"
    FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "user_equipment" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "equipment_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_equipment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_equipment_user_id_equipment_id_key"
  ON "user_equipment"("user_id", "equipment_id");
CREATE INDEX IF NOT EXISTS "user_equipment_user_id_idx" ON "user_equipment"("user_id");

DO $$ BEGIN
  ALTER TABLE "user_equipment"
    ADD CONSTRAINT "user_equipment_equipment_id_fkey"
    FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
