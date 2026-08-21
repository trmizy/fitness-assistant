CREATE TABLE IF NOT EXISTS "plan_generation_audits" (
  "id" TEXT NOT NULL,
  "pt_user_id" TEXT NOT NULL,
  "client_user_id" TEXT NOT NULL,
  "pt_notes" TEXT,
  "request_snapshot" JSONB NOT NULL,
  "draft_days" JSONB NOT NULL,
  "data_gaps" JSONB NOT NULL,
  "warnings" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "plan_generation_audits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "plan_generation_audits_pt_user_id_client_user_id_idx" ON "plan_generation_audits"("pt_user_id", "client_user_id");
CREATE INDEX IF NOT EXISTS "plan_generation_audits_client_user_id_created_at_idx" ON "plan_generation_audits"("client_user_id", "created_at");
