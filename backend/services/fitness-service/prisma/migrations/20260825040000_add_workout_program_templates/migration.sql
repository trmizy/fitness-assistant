-- Roadmap P2.6 "Workout template sharing/import"
-- (docs/features/WORKOUT_TEMPLATE_SHARING_IMPACT_ANALYSIS.md)
CREATE TABLE "workout_program_templates" (
    "id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "goal" TEXT,
    "duration_weeks" INTEGER NOT NULL,
    "days_per_week" INTEGER NOT NULL,
    "days_json" JSONB NOT NULL,
    "shared_with_user_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workout_program_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "workout_program_templates_created_by_user_id_idx" ON "workout_program_templates"("created_by_user_id");
