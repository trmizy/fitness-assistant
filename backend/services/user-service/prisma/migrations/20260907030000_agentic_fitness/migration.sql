-- AlterTable
ALTER TABLE "user_profiles" ADD COLUMN     "data_origin" TEXT NOT NULL DEFAULT 'REAL',
ADD COLUMN     "goal_intent" JSONB,
ADD COLUMN     "pt_budget_vnd" INTEGER;

-- AlterTable
ALTER TABLE "pt_applications" ADD COLUMN     "languages" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "pt_application_certificates" ADD COLUMN     "certification_number" TEXT,
ADD COLUMN     "verification_status" TEXT NOT NULL DEFAULT 'UNVERIFIED';

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "agent_action_id" TEXT,
ADD COLUMN     "data_origin" TEXT NOT NULL DEFAULT 'REAL';

-- CreateTable
CREATE TABLE "client_journeys" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "pt_id" TEXT,
    "contract_id" TEXT,
    "program_id" TEXT,
    "training_cycle_id" TEXT,
    "nutrition_goal_id" TEXT,
    "goal" TEXT NOT NULL,
    "experience" TEXT NOT NULL,
    "age_band" TEXT,
    "baseline_weight" DOUBLE PRECISION NOT NULL,
    "baseline_body_fat" DOUBLE PRECISION,
    "baseline_lean_mass" DOUBLE PRECISION,
    "training_days" INTEGER NOT NULL,
    "session_minutes" INTEGER NOT NULL,
    "constraints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "duration_weeks" INTEGER NOT NULL,
    "sessions_prescribed" INTEGER NOT NULL,
    "sessions_completed" INTEGER NOT NULL DEFAULT 0,
    "nutrition_adherence" DOUBLE PRECISION,
    "ending_weight" DOUBLE PRECISION,
    "ending_body_fat" DOUBLE PRECISION,
    "ending_lean_mass" DOUBLE PRECISION,
    "strength_change_percent" DOUBLE PRECISION,
    "goal_achievement" TEXT,
    "verification_status" TEXT NOT NULL DEFAULT 'SELF_REPORTED',
    "data_origin" TEXT NOT NULL DEFAULT 'REAL',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "baseline_snapshot" JSONB,

    CONSTRAINT "client_journeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_contract_drafts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "pt_id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "contract_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_contract_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_journeys_data_origin_status_goal_experience_baseline_idx" ON "client_journeys"("data_origin", "status", "goal", "experience", "baseline_weight");

-- CreateIndex
CREATE INDEX "client_journeys_pt_id_data_origin_status_idx" ON "client_journeys"("pt_id", "data_origin", "status");

-- CreateIndex
CREATE INDEX "client_journeys_program_id_data_origin_status_idx" ON "client_journeys"("program_id", "data_origin", "status");

-- CreateIndex
CREATE INDEX "client_journeys_user_id_started_at_idx" ON "client_journeys"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "agent_contract_drafts_user_id_created_at_idx" ON "agent_contract_drafts"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_agent_action_id_key" ON "contracts"("agent_action_id");

-- AddForeignKey
ALTER TABLE "client_journeys" ADD CONSTRAINT "client_journeys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profiles"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_journeys" ADD CONSTRAINT "client_journeys_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_contract_drafts" ADD CONSTRAINT "agent_contract_drafts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profiles"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

