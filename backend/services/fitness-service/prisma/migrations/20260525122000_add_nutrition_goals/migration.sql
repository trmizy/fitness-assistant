-- CreateTable
--
-- IF NOT EXISTS: the dev database already had this table from `db push` before this migration
-- history became the source of truth (see 20260816000000_catch_up_db_push_drift for the fuller
-- version of this problem). A plain CREATE TABLE fails on replay against that database with
-- "relation nutrition_goals already exists" — this makes both a fresh database and the
-- already-drifted dev database reach the same state.
CREATE TABLE IF NOT EXISTS "nutrition_goals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "calories" INTEGER NOT NULL,
    "protein" DOUBLE PRECISION NOT NULL,
    "carbs" DOUBLE PRECISION NOT NULL,
    "fat" DOUBLE PRECISION NOT NULL,
    "water_ml" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nutrition_goals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "nutrition_goals_user_id_key" ON "nutrition_goals"("user_id");
