CREATE TABLE IF NOT EXISTS "coach_client_action_audits" (
  "id" TEXT NOT NULL,
  "pt_user_id" TEXT NOT NULL,
  "client_user_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "coach_client_action_audits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "coach_client_action_audits_pt_user_id_client_user_id_idx" ON "coach_client_action_audits"("pt_user_id", "client_user_id");
CREATE INDEX IF NOT EXISTS "coach_client_action_audits_client_user_id_created_at_idx" ON "coach_client_action_audits"("client_user_id", "created_at");
