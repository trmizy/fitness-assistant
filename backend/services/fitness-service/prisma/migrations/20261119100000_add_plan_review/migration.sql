-- Workout Plan Review & Approval. Additive only (expand step): new enum + 2 tables.
-- LOCAL/TEST DATABASES ONLY until the owner approves a deploy — never applied to AWS from this change.

CREATE TYPE "PlanReviewStatus" AS ENUM ('PENDING_REVIEW', 'IN_REVIEW', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'CANCELLED', 'SUPERSEDED', 'ACCESS_REVOKED');

CREATE TABLE "plan_review_requests" (
  "id" TEXT NOT NULL,
  "client_user_id" TEXT NOT NULL,
  "pt_user_id" TEXT NOT NULL,
  "subject_type" TEXT NOT NULL DEFAULT 'WORKOUT_PROGRAM',
  "subject_id" TEXT NOT NULL,
  "subject_version" INTEGER NOT NULL,
  "content_hash" TEXT NOT NULL,
  "source_plan_id" TEXT,
  "ai_plan_version" INTEGER,
  "snapshot" JSONB NOT NULL,
  "status" "PlanReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "idempotency_key" TEXT,
  "client_note" TEXT,
  "decision_note" TEXT,
  "decided_at" TIMESTAMP(3),
  "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "plan_review_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "plan_review_events" (
  "id" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "actor_user_id" TEXT,
  "actor_role" TEXT NOT NULL,
  "from_status" TEXT,
  "to_status" TEXT NOT NULL,
  "content_hash" TEXT NOT NULL,
  "note" TEXT,
  "metadata" JSONB,
  "notify_user_id" TEXT,
  "notified_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plan_review_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plan_review_requests_client_user_id_idempotency_key_key" ON "plan_review_requests"("client_user_id", "idempotency_key");
CREATE INDEX "plan_review_requests_pt_user_id_status_idx" ON "plan_review_requests"("pt_user_id", "status");
CREATE INDEX "plan_review_requests_client_user_id_status_idx" ON "plan_review_requests"("client_user_id", "status");
CREATE INDEX "plan_review_requests_subject_type_subject_id_idx" ON "plan_review_requests"("subject_type", "subject_id");
CREATE INDEX "plan_review_events_request_id_created_at_idx" ON "plan_review_events"("request_id", "created_at");
CREATE INDEX "plan_review_events_notify_user_id_notified_at_idx" ON "plan_review_events"("notify_user_id", "notified_at");

ALTER TABLE "plan_review_events"
  ADD CONSTRAINT "plan_review_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "plan_review_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Race backstop: at most ONE open request per (client, plan). Prisma cannot express a partial unique index,
-- so — like add_training_cycle_active_unique_constraint — it lives here, and the service maps P2002 to a clean reuse/409.
CREATE UNIQUE INDEX "plan_review_requests_one_open_per_subject"
  ON "plan_review_requests"("client_user_id", "subject_type", "subject_id")
  WHERE "status" IN ('PENDING_REVIEW', 'IN_REVIEW');
