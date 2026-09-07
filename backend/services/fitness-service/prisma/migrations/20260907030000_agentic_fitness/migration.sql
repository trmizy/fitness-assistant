-- AlterTable
ALTER TABLE "workout_programs" ADD COLUMN     "agent_action_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "workout_programs_agent_action_id_key" ON "workout_programs"("agent_action_id");


ALTER TABLE "workout_program_templates" ADD COLUMN "is_public" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "data_origin" TEXT NOT NULL DEFAULT 'REAL', ADD COLUMN "experience_level" TEXT;
CREATE INDEX "workout_program_templates_agent_candidates_idx" ON "workout_program_templates" ("is_public", "data_origin", "goal", "days_per_week");
