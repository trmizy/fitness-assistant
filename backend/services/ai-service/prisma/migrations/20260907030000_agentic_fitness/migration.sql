-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "structured_blocks" JSONB;

-- CreateTable
CREATE TABLE "fitness_recommendations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "context_snapshot" JSONB NOT NULL,
    "candidate_ids" TEXT[],
    "scoring_version" TEXT NOT NULL,
    "similarity_version" TEXT NOT NULL,
    "evidence_ids" TEXT[],
    "historical_journey_ids" TEXT[],
    "result" JSONB NOT NULL,
    "selected_candidate_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fitness_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fitness_agent_actions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "recommendation_id" TEXT,
    "kind" TEXT NOT NULL,
    "risk" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fitness_agent_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fitness_recommendations_user_id_session_id_created_at_idx" ON "fitness_recommendations"("user_id", "session_id", "created_at");

-- CreateIndex
CREATE INDEX "fitness_agent_actions_user_id_session_id_created_at_idx" ON "fitness_agent_actions"("user_id", "session_id", "created_at");

