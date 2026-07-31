-- CreateTable
CREATE TABLE "training_cycles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source_plan_id" TEXT,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "goal_at_start" TEXT,
    "target_weight_at_start" DOUBLE PRECISION,
    "start_weight_kg" DOUBLE PRECISION,
    "start_body_fat_pct" DOUBLE PRECISION,
    "start_muscle_mass_kg" DOUBLE PRECISION,
    "start_inbody_date" TIMESTAMP(3),
    "end_weight_kg" DOUBLE PRECISION,
    "end_body_fat_pct" DOUBLE PRECISION,
    "end_muscle_mass_kg" DOUBLE PRECISION,
    "end_inbody_date" TIMESTAMP(3),
    "adherence_percent" INTEGER,
    "outcome" TEXT,
    "outcome_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "training_cycles_user_id_status_idx" ON "training_cycles"("user_id", "status");

-- CreateIndex
CREATE INDEX "training_cycles_user_id_start_date_idx" ON "training_cycles"("user_id", "start_date");
