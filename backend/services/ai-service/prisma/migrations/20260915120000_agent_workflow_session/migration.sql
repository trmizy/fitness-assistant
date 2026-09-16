-- Conversational AI Coach workflow orchestration
-- (docs/conversational-ai-coach-workflow-audit.md §8): neither ChatSession
-- nor FitnessAgentAction can safely represent multi-turn slot-filling state
-- (audit confirmed: ChatSession has no metadata JSON column at all;
-- FitnessAgentAction is a single fixed-purpose 15-minute action-confirmation
-- row with no "expected next slot" concept). This is a new, narrow,
-- additive table — never business truth, only transient orchestration state.
CREATE TABLE "agent_workflow_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "workflow_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COLLECTING_SLOTS',
    "expected_slot" TEXT,
    "slots_json" JSONB NOT NULL DEFAULT '{}',
    "pending_profile_update" JSONB,
    "draft_ref" JSONB,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_workflow_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_workflow_sessions_user_id_session_id_status_idx" ON "agent_workflow_sessions"("user_id", "session_id", "status");
