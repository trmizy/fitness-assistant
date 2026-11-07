-- Dispute V2.1 process (Ngai 05/11/2026): CLOSED in use, execution lease (C4), response deadlines, mutual agreement, appeal, held-money review. ADDITIVE except the two statements marked MIGRATE.

-- A5 / MIGRATE 1: CLOSED counts as terminal for the one-open-case-per-session rule.
DROP INDEX "dispute_cases_one_open_per_session";
CREATE UNIQUE INDEX "dispute_cases_one_open_per_session" ON "dispute_cases"("session_id") WHERE "status" NOT IN ('DECISION_APPROVED', 'REJECTED_INTAKE', 'CLOSED');
-- A5 / MIGRATE 2: the earlier "closed without a decision" usage of REJECTED_INTAKE (orphan, NOT_A_DISPUTE) becomes CLOSED. A real intake rejection (INTAKE_REJECTED / no reason) stays REJECTED_INTAKE.
UPDATE "dispute_cases" SET "status" = 'CLOSED' WHERE "status" = 'REJECTED_INTAKE' AND "close_reason" IN ('ORPHAN_SESSION_LEFT_DISPUTE', 'NOT_A_DISPUTE');

ALTER TABLE "dispute_cases" ADD COLUMN "exec_lease_owner" TEXT, ADD COLUMN "exec_lease_until" TIMESTAMPTZ(3);

CREATE TABLE "dispute_case_party_notices" (
  "id" UUID NOT NULL, "case_id" UUID, "session_id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "party_role" TEXT NOT NULL, "kind" TEXT NOT NULL,
  "notification_id" TEXT NOT NULL, "recorded_at" TIMESTAMPTZ(3) NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dispute_case_party_notices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "dispute_case_party_notices_notification_id_key" ON "dispute_case_party_notices"("notification_id");
CREATE INDEX "dispute_case_party_notices_case_id_kind_user_id_idx" ON "dispute_case_party_notices"("case_id", "kind", "user_id");
CREATE INDEX "dispute_case_party_notices_session_id_kind_idx" ON "dispute_case_party_notices"("session_id", "kind");
ALTER TABLE "dispute_case_party_notices" ADD CONSTRAINT "dispute_case_party_notices_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "dispute_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute_case_party_notices" ADD CONSTRAINT "dc_party_notice_kind" CHECK ("kind" IN ('RESPONSE_REQUESTED', 'PT_NO_SHOW_ANSWER', 'CONCLUSION'));
ALTER TABLE "dispute_case_party_notices" ADD CONSTRAINT "dc_party_notice_role" CHECK ("party_role" IN ('CLIENT', 'PT'));

CREATE TABLE "dispute_case_deadlines" (
  "id" UUID NOT NULL, "case_id" UUID, "session_id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "party_role" TEXT NOT NULL, "kind" TEXT NOT NULL, "hours" INTEGER NOT NULL,
  "started_at" TIMESTAMPTZ(3) NOT NULL, "paused_at" TIMESTAMPTZ(3), "paused_seconds" INTEGER NOT NULL DEFAULT 0, "status" TEXT NOT NULL DEFAULT 'OPEN',
  "satisfied_at" TIMESTAMPTZ(3), "expired_at" TIMESTAMPTZ(3), "notice_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "dispute_case_deadlines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "dispute_case_deadlines_status_kind_idx" ON "dispute_case_deadlines"("status", "kind");
CREATE INDEX "dispute_case_deadlines_case_id_status_idx" ON "dispute_case_deadlines"("case_id", "status");
ALTER TABLE "dispute_case_deadlines" ADD CONSTRAINT "dispute_case_deadlines_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "dispute_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute_case_deadlines" ADD CONSTRAINT "dc_deadline_kind" CHECK ("kind" IN ('PT_NO_SHOW_ANSWER', 'FIRST_RESPONSE', 'SUPPLEMENT_ROUND'));
ALTER TABLE "dispute_case_deadlines" ADD CONSTRAINT "dc_deadline_status" CHECK ("status" IN ('OPEN', 'SATISFIED', 'EXPIRED', 'CANCELLED'));
ALTER TABLE "dispute_case_deadlines" ADD CONSTRAINT "dc_deadline_hours" CHECK ("hours" IN (48, 72));
-- at most ONE open clock per (session, user, kind[, case])
CREATE UNIQUE INDEX "dc_deadline_one_open" ON "dispute_case_deadlines"("session_id", "user_id", "kind", (COALESCE("case_id"::text, ''))) WHERE "status" = 'OPEN';

CREATE TABLE "dispute_case_agreements" (
  "id" UUID NOT NULL, "case_id" UUID NOT NULL, "outcome" TEXT NOT NULL, "content_hash" TEXT NOT NULL, "note" TEXT NOT NULL, "proposed_by" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PROPOSED', "agreed_at" TIMESTAMPTZ(3), "finding_id" UUID, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dispute_case_agreements_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "dispute_case_agreements_case_id_status_idx" ON "dispute_case_agreements"("case_id", "status");
ALTER TABLE "dispute_case_agreements" ADD CONSTRAINT "dispute_case_agreements_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "dispute_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute_case_agreements" ADD CONSTRAINT "dc_agreement_outcome" CHECK ("outcome" IN ('COMPLETED', 'CANCELLED', 'PT_NO_SHOW_CONFIRMED'));
ALTER TABLE "dispute_case_agreements" ADD CONSTRAINT "dc_agreement_status" CHECK ("status" IN ('PROPOSED', 'AGREED', 'WITHDRAWN', 'USED'));

CREATE TABLE "dispute_case_agreement_confirmations" (
  "id" UUID NOT NULL, "agreement_id" UUID NOT NULL, "party_role" TEXT NOT NULL, "user_id" TEXT NOT NULL, "confirmed_hash" TEXT NOT NULL,
  "confirmed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "dispute_case_agreement_confirmations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "dispute_case_agreement_confirmations_agreement_id_party_role_key" ON "dispute_case_agreement_confirmations"("agreement_id", "party_role");
ALTER TABLE "dispute_case_agreement_confirmations" ADD CONSTRAINT "dispute_case_agreement_confirmations_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "dispute_case_agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "dispute_case_appeals" (
  "id" UUID NOT NULL, "case_id" UUID NOT NULL, "party_role" TEXT NOT NULL, "requested_by" TEXT NOT NULL, "reason" TEXT NOT NULL, "notice_recorded_at" TIMESTAMPTZ(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'REQUESTED', "reviewer_id" TEXT, "reviewer_assigned_by" TEXT, "result" TEXT, "reasoning" TEXT, "previous_finding_id" UUID, "new_finding_id" UUID,
  "decided_at" TIMESTAMPTZ(3), "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "dispute_case_appeals_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "dispute_case_appeals_case_id_party_role_key" ON "dispute_case_appeals"("case_id", "party_role");
ALTER TABLE "dispute_case_appeals" ADD CONSTRAINT "dispute_case_appeals_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "dispute_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute_case_appeals" ADD CONSTRAINT "dc_appeal_status" CHECK ("status" IN ('REQUESTED', 'UNDER_REVIEW', 'DECIDED'));
ALTER TABLE "dispute_case_appeals" ADD CONSTRAINT "dc_appeal_result" CHECK ("result" IS NULL OR "result" IN ('UPHELD', 'NEW_FINDING'));

CREATE TABLE "dispute_case_appeal_consequences" (
  "id" UUID NOT NULL, "appeal_id" UUID NOT NULL, "case_id" UUID NOT NULL, "kind" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'OPEN', "detail" JSONB, "note" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "resolved_at" TIMESTAMPTZ(3), "resolved_by" TEXT, CONSTRAINT "dispute_case_appeal_consequences_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "dispute_case_appeal_consequences_case_id_status_idx" ON "dispute_case_appeal_consequences"("case_id", "status");
ALTER TABLE "dispute_case_appeal_consequences" ADD CONSTRAINT "dispute_case_appeal_consequences_appeal_id_fkey" FOREIGN KEY ("appeal_id") REFERENCES "dispute_case_appeals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute_case_appeal_consequences" ADD CONSTRAINT "dc_consequence_kind" CHECK ("kind" IN ('MONEY', 'QUOTA', 'PT_AT_FAULT'));
ALTER TABLE "dispute_case_appeal_consequences" ADD CONSTRAINT "dc_consequence_status" CHECK ("status" IN ('OPEN', 'RESOLVED', 'NEEDS_RECONCILIATION'));

CREATE TABLE "dispute_case_quota_corrections" (
  "id" UUID NOT NULL, "consequence_id" UUID NOT NULL, "case_id" UUID NOT NULL, "contract_id" TEXT NOT NULL, "delta" INTEGER NOT NULL, "reason" TEXT NOT NULL,
  "proposed_by" TEXT NOT NULL, "approved_by" TEXT, "approved_at" TIMESTAMPTZ(3), "applied_at" TIMESTAMPTZ(3), "used_before" INTEGER, "used_after" INTEGER,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "dispute_case_quota_corrections_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "dispute_case_quota_corrections_consequence_id_idx" ON "dispute_case_quota_corrections"("consequence_id");
ALTER TABLE "dispute_case_quota_corrections" ADD CONSTRAINT "dispute_case_quota_corrections_consequence_id_fkey" FOREIGN KEY ("consequence_id") REFERENCES "dispute_case_appeal_consequences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute_case_quota_corrections" ADD CONSTRAINT "dc_quota_delta_nonzero" CHECK ("delta" <> 0);
ALTER TABLE "dispute_case_quota_corrections" ADD CONSTRAINT "dc_quota_four_eyes" CHECK ("approved_by" IS NULL OR "approved_by" <> "proposed_by");

CREATE TABLE "dispute_held_money_reviews" (
  "id" UUID NOT NULL, "settlement_row_id" TEXT NOT NULL, "session_id" TEXT NOT NULL, "contract_id" TEXT NOT NULL, "first_seen_at" TIMESTAMPTZ(3) NOT NULL,
  "next_review_due_at" TIMESTAMPTZ(3) NOT NULL, "owner_escalated_at" TIMESTAMPTZ(3), "closed_at" TIMESTAMPTZ(3), "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dispute_held_money_reviews_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "dispute_held_money_reviews_settlement_row_id_key" ON "dispute_held_money_reviews"("settlement_row_id");
CREATE INDEX "dispute_held_money_reviews_closed_at_next_review_due_at_idx" ON "dispute_held_money_reviews"("closed_at", "next_review_due_at");

CREATE TABLE "dispute_held_money_decisions" (
  "id" UUID NOT NULL, "review_id" UUID NOT NULL, "decision" TEXT NOT NULL, "reason" TEXT NOT NULL, "exit_ref" TEXT, "decided_by" TEXT NOT NULL,
  "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "dispute_held_money_decisions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "dispute_held_money_decisions_review_id_decided_at_idx" ON "dispute_held_money_decisions"("review_id", "decided_at");
ALTER TABLE "dispute_held_money_decisions" ADD CONSTRAINT "dispute_held_money_decisions_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "dispute_held_money_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute_held_money_decisions" ADD CONSTRAINT "dc_held_decision" CHECK ("decision" IN ('KEEP_HOLDING', 'EXIT_STARTED'));
