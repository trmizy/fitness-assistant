-- New table: interaction log for Decision Engine output, distinct from
-- cycle_assessments (the computed result). See
-- docs/TRAINING_CYCLE_DECISION_ENGINE.md §4.
CREATE TABLE "recommendation_audits" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "assessment_id" TEXT,
    "engine_version" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reason_codes" JSONB NOT NULL,
    "metrics_snapshot" JSONB NOT NULL,
    "ai_summary" TEXT,
    "presented_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_action" TEXT,
    "user_action_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendation_audits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "recommendation_audits_user_id_cycle_id_idx" ON "recommendation_audits"("user_id", "cycle_id");
CREATE INDEX "recommendation_audits_cycle_id_presented_at_idx" ON "recommendation_audits"("cycle_id", "presented_at");
