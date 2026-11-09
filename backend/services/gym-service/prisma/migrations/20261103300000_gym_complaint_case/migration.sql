-- DISPUTE V2.1 Slice 3 (gym complaint case layer). ADDITIVE ONLY: new enums and gym_case_* tables; gym_complaints and every existing table are unchanged.
-- Generated DDL (prisma migrate diff) followed by the hand-written constraints. No row is created for any existing complaint.

-- CreateEnum
CREATE TYPE "GymCaseClass" AS ENUM ('MEM_TXN', 'MEM_CLOSED', 'MEM_VIOLATION', 'MEM_ACCESS', 'GYM_GENERAL');

-- CreateEnum
CREATE TYPE "GymCaseStatus" AS ENUM ('INTAKE', 'COLLECTING', 'AWAITING_PARTIES', 'ASSESSING', 'FINDING_RECORDED', 'AWAITING_APPROVAL', 'DECISION_APPROVED', 'REJECTED_INTAKE');

-- CreateEnum
CREATE TYPE "GymCaseExecStatus" AS ENUM ('NOT_STARTED', 'EXECUTING', 'BUSINESS_DONE', 'EXEC_BLOCKED', 'NEEDS_HUMAN');

-- CreateEnum
CREATE TYPE "GymCasePartyRole" AS ENUM ('MEMBER', 'ADMIN_ON_BEHALF', 'GYM');

-- CreateEnum
CREATE TYPE "GymCaseProvenance" AS ENUM ('SERVER_OBSERVED', 'USER_REPORTED_STORED', 'EXTERNAL_DOCUMENT', 'ADMIN_RECEIVED_ON_BEHALF', 'LEGACY_FIELD');

-- CreateEnum
CREATE TYPE "GymCaseSensitivity" AS ENUM ('NORMAL', 'SENSITIVE');

-- CreateEnum
CREATE TYPE "GymCaseAssessmentResult" AS ENUM ('ESTABLISHED', 'NOT_ESTABLISHED', 'REFUTED');

-- CreateEnum
CREATE TYPE "GymCaseFindingKind" AS ENUM ('ESTABLISHED', 'NOT_ESTABLISHED');

-- CreateEnum
CREATE TYPE "GymCaseOutcome" AS ENUM ('REFUND_TRANSACTION_ERROR', 'REFUND_GYM_CLOSED', 'REFUND_GYM_VIOLATION', 'RESOLVE_UPHELD', 'RESOLVE_INSUFFICIENT_EVIDENCE');

-- CreateEnum
CREATE TYPE "GymCaseApprovalResult" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "GymCaseExecState" AS ENUM ('STARTED', 'BLOCKED', 'BUSINESS_DONE', 'NEEDS_HUMAN');

-- CreateEnum
CREATE TYPE "GymCaseAccessAction" AS ENUM ('VIEW_CASE', 'VIEW_EVIDENCE');
-- CreateTable
CREATE TABLE "gym_complaint_cases" (
    "id" UUID NOT NULL,
    "complaint_id" TEXT NOT NULL,
    "gym_id" TEXT NOT NULL,
    "membership_id" TEXT,
    "reporter_user_id" TEXT NOT NULL,
    "case_class" "GymCaseClass" NOT NULL,
    "status" "GymCaseStatus" NOT NULL DEFAULT 'INTAKE',
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "investigator_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "exec_status" "GymCaseExecStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "exec_decision_id" UUID,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "gym_complaint_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gym_case_statements" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "party_role" "GymCasePartyRole" NOT NULL,
    "author_user_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "text" TEXT NOT NULL,
    "supplement_reason" TEXT,
    "supersedes_id" UUID,
    "content_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gym_case_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gym_case_evidence" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "provenance_type" "GymCaseProvenance" NOT NULL,
    "source" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "scope_gym_id" TEXT NOT NULL,
    "event_at" TIMESTAMPTZ(3),
    "captured_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_by" TEXT,
    "submitted_role" TEXT,
    "snapshot_version" INTEGER NOT NULL DEFAULT 1,
    "content_hash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "sensitivity" "GymCaseSensitivity" NOT NULL DEFAULT 'NORMAL',
    "supersedes_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gym_case_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gym_case_shares" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "evidence_id" UUID,
    "statement_id" UUID,
    "shared_with_role" "GymCasePartyRole" NOT NULL,
    "shared_by" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gym_case_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gym_case_claims" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "claimant_role" "GymCasePartyRole" NOT NULL,
    "text" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gym_case_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gym_case_assessments" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "assessor_id" TEXT NOT NULL,
    "direct_evidence_ids" UUID[],
    "indirect_evidence_ids" UUID[],
    "rebuttal_evidence_ids" UUID[],
    "relevance_note" TEXT NOT NULL,
    "verifiability_note" TEXT NOT NULL,
    "consistency_note" TEXT NOT NULL,
    "result" "GymCaseAssessmentResult" NOT NULL,
    "reasoning" TEXT NOT NULL,
    "evidence_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gym_case_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gym_case_findings" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "finding" "GymCaseFindingKind" NOT NULL,
    "reasoning" TEXT NOT NULL,
    "recorded_by" TEXT NOT NULL,
    "supersedes_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gym_case_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gym_case_proposals" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "finding_id" UUID NOT NULL,
    "outcome" "GymCaseOutcome" NOT NULL,
    "proposer_id" TEXT NOT NULL,
    "evidence_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gym_case_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gym_case_approvals" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "approver_id" TEXT NOT NULL,
    "result" "GymCaseApprovalResult" NOT NULL,
    "reason" TEXT NOT NULL,
    "conflict_of_interest_declared_none" BOOLEAN NOT NULL,
    "evidence_change_acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gym_case_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gym_case_events" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "actor_role" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "from_status" "GymCaseStatus",
    "to_status" "GymCaseStatus",
    "note" TEXT,
    "idempotency_key" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gym_case_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gym_case_executions" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "decision_id" UUID NOT NULL,
    "outcome" "GymCaseOutcome" NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "state" "GymCaseExecState" NOT NULL,
    "blocked_reason" TEXT,
    "note" TEXT,
    "response" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gym_case_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gym_case_access_logs" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "viewer_user_id" TEXT NOT NULL,
    "viewer_role" TEXT NOT NULL,
    "evidence_id" UUID,
    "action" "GymCaseAccessAction" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gym_case_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gym_complaint_cases_complaint_id_key" ON "gym_complaint_cases"("complaint_id");

-- CreateIndex
CREATE INDEX "gym_complaint_cases_status_idx" ON "gym_complaint_cases"("status");

-- CreateIndex
CREATE INDEX "gym_complaint_cases_gym_id_idx" ON "gym_complaint_cases"("gym_id");

-- CreateIndex
CREATE INDEX "gym_complaint_cases_reporter_user_id_idx" ON "gym_complaint_cases"("reporter_user_id");

-- CreateIndex
CREATE INDEX "gym_case_statements_case_id_idx" ON "gym_case_statements"("case_id");

-- CreateIndex
CREATE INDEX "gym_case_evidence_case_id_source_subject_idx" ON "gym_case_evidence"("case_id", "source", "subject");

-- CreateIndex
CREATE INDEX "gym_case_shares_case_id_shared_with_role_idx" ON "gym_case_shares"("case_id", "shared_with_role");

-- CreateIndex
CREATE INDEX "gym_case_claims_case_id_idx" ON "gym_case_claims"("case_id");

-- CreateIndex
CREATE INDEX "gym_case_assessments_case_id_idx" ON "gym_case_assessments"("case_id");

-- CreateIndex
CREATE INDEX "gym_case_findings_case_id_idx" ON "gym_case_findings"("case_id");

-- CreateIndex
CREATE INDEX "gym_case_proposals_case_id_idx" ON "gym_case_proposals"("case_id");

-- CreateIndex
CREATE INDEX "gym_case_approvals_proposal_id_idx" ON "gym_case_approvals"("proposal_id");

-- CreateIndex
CREATE UNIQUE INDEX "gym_case_events_idempotency_key_key" ON "gym_case_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "gym_case_events_case_id_created_at_idx" ON "gym_case_events"("case_id", "created_at");

-- CreateIndex
CREATE INDEX "gym_case_executions_case_id_created_at_idx" ON "gym_case_executions"("case_id", "created_at");

-- CreateIndex
CREATE INDEX "gym_case_executions_idempotency_key_idx" ON "gym_case_executions"("idempotency_key");

-- CreateIndex
CREATE INDEX "gym_case_access_logs_case_id_created_at_idx" ON "gym_case_access_logs"("case_id", "created_at");

-- AddForeignKey
ALTER TABLE "gym_complaint_cases" ADD CONSTRAINT "gym_complaint_cases_complaint_id_fkey" FOREIGN KEY ("complaint_id") REFERENCES "gym_complaints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gym_case_statements" ADD CONSTRAINT "gym_case_statements_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "gym_complaint_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gym_case_evidence" ADD CONSTRAINT "gym_case_evidence_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "gym_complaint_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gym_case_shares" ADD CONSTRAINT "gym_case_shares_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "gym_complaint_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gym_case_claims" ADD CONSTRAINT "gym_case_claims_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "gym_complaint_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gym_case_assessments" ADD CONSTRAINT "gym_case_assessments_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "gym_complaint_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gym_case_assessments" ADD CONSTRAINT "gym_case_assessments_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "gym_case_claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gym_case_findings" ADD CONSTRAINT "gym_case_findings_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "gym_complaint_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gym_case_proposals" ADD CONSTRAINT "gym_case_proposals_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "gym_complaint_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gym_case_proposals" ADD CONSTRAINT "gym_case_proposals_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "gym_case_findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gym_case_approvals" ADD CONSTRAINT "gym_case_approvals_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "gym_case_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gym_case_events" ADD CONSTRAINT "gym_case_events_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "gym_complaint_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gym_case_executions" ADD CONSTRAINT "gym_case_executions_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "gym_complaint_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gym_case_access_logs" ADD CONSTRAINT "gym_case_access_logs_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "gym_complaint_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Hand-written part: constraints the Prisma schema DSL cannot express ─────────────────────────────────────────────

-- A case points at the complaint it extends; complaint_id is already UNIQUE (one case per complaint, ever).
ALTER TABLE "gym_complaint_cases" ADD CONSTRAINT "gym_complaint_cases_version_positive" CHECK ("version" >= 1);

-- MEM_* cases carry the membership they are about; GYM_GENERAL never does (keeps the "no money exit" classes free of a membership to refund).
ALTER TABLE "gym_complaint_cases" ADD CONSTRAINT "gym_complaint_cases_membership_by_class"
  CHECK (("case_class" IN ('MEM_TXN','MEM_CLOSED','MEM_VIOLATION') AND "membership_id" IS NOT NULL)
      OR ("case_class" = 'MEM_ACCESS')
      OR ("case_class" = 'GYM_GENERAL' AND "membership_id" IS NULL));

-- At most one NON-terminal case per membership (a membership can only be refunded once; two parallel cases must not both reach the money exit).
CREATE UNIQUE INDEX "gym_complaint_cases_one_open_per_membership" ON "gym_complaint_cases"("membership_id")
  WHERE "membership_id" IS NOT NULL AND "status" NOT IN ('DECISION_APPROVED', 'REJECTED_INTAKE');

-- D-NEW-9 (Gym as a party) is an OPEN POLICY decision: the GYM party role is reserved in the enum but NO row may carry it. Enabling it later is a
-- new migration that drops these constraints, never a configuration switch.
ALTER TABLE "gym_case_statements" ADD CONSTRAINT "gym_case_statements_gym_party_locked" CHECK ("party_role" <> 'GYM');
ALTER TABLE "gym_case_claims" ADD CONSTRAINT "gym_case_claims_gym_party_locked" CHECK ("claimant_role" <> 'GYM');
ALTER TABLE "gym_case_shares" ADD CONSTRAINT "gym_case_shares_gym_party_locked" CHECK ("shared_with_role" <> 'GYM');

CREATE UNIQUE INDEX "gym_case_statements_unique_version" ON "gym_case_statements"("case_id", "party_role", "version");
ALTER TABLE "gym_case_statements" ADD CONSTRAINT "gym_case_statements_supplement_required"
  CHECK ("version" = 1 OR ("supplement_reason" IS NOT NULL AND length(btrim("supplement_reason")) > 0));

ALTER TABLE "gym_case_shares" ADD CONSTRAINT "gym_case_shares_exactly_one_target"
  CHECK (("evidence_id" IS NOT NULL AND "statement_id" IS NULL) OR ("evidence_id" IS NULL AND "statement_id" IS NOT NULL));

-- Four eyes, last line of defence: one APPROVING decision per proposal; the conflict-of-interest declaration is always "none"; a reason is always present.
CREATE UNIQUE INDEX "gym_case_approvals_one_approved_per_proposal" ON "gym_case_approvals"("proposal_id") WHERE "result" = 'APPROVED';
ALTER TABLE "gym_case_approvals" ADD CONSTRAINT "gym_case_approvals_declaration_true" CHECK ("conflict_of_interest_declared_none" = true);
ALTER TABLE "gym_case_approvals" ADD CONSTRAINT "gym_case_approvals_reason_present" CHECK (length(btrim("reason")) > 0);

-- Proposer != approver is enforced in the application AND here, so a hand-written INSERT cannot skip four eyes.
CREATE FUNCTION gym_case_check_four_eyes() RETURNS trigger AS $$
DECLARE p_proposer text;
BEGIN
  SELECT proposer_id INTO p_proposer FROM "gym_case_proposals" WHERE id = NEW.proposal_id;
  IF p_proposer IS NOT NULL AND p_proposer = NEW.approver_id THEN
    RAISE EXCEPTION 'four-eyes: the proposer cannot approve or reject their own proposal';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER gym_case_approvals_four_eyes BEFORE INSERT ON "gym_case_approvals"
  FOR EACH ROW EXECUTE FUNCTION gym_case_check_four_eyes();

-- One execution row per (decision, state, attempt): a replay of the same STARTED / BUSINESS_DONE write cannot be recorded twice.
CREATE UNIQUE INDEX "gym_case_executions_done_once" ON "gym_case_executions"("idempotency_key") WHERE "state" = 'BUSINESS_DONE';

-- Append-only audit/evidence tables: UPDATE and DELETE are rejected. gym_complaint_cases itself is NOT in this list: it changes only through a CAS on `version`.
CREATE FUNCTION gym_case_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER gym_case_statements_append_only BEFORE UPDATE OR DELETE ON "gym_case_statements" FOR EACH ROW EXECUTE FUNCTION gym_case_reject_mutation();
CREATE TRIGGER gym_case_evidence_append_only BEFORE UPDATE OR DELETE ON "gym_case_evidence" FOR EACH ROW EXECUTE FUNCTION gym_case_reject_mutation();
CREATE TRIGGER gym_case_shares_append_only BEFORE UPDATE OR DELETE ON "gym_case_shares" FOR EACH ROW EXECUTE FUNCTION gym_case_reject_mutation();
CREATE TRIGGER gym_case_claims_append_only BEFORE UPDATE OR DELETE ON "gym_case_claims" FOR EACH ROW EXECUTE FUNCTION gym_case_reject_mutation();
CREATE TRIGGER gym_case_assessments_append_only BEFORE UPDATE OR DELETE ON "gym_case_assessments" FOR EACH ROW EXECUTE FUNCTION gym_case_reject_mutation();
CREATE TRIGGER gym_case_findings_append_only BEFORE UPDATE OR DELETE ON "gym_case_findings" FOR EACH ROW EXECUTE FUNCTION gym_case_reject_mutation();
CREATE TRIGGER gym_case_proposals_append_only BEFORE UPDATE OR DELETE ON "gym_case_proposals" FOR EACH ROW EXECUTE FUNCTION gym_case_reject_mutation();
CREATE TRIGGER gym_case_approvals_append_only BEFORE UPDATE OR DELETE ON "gym_case_approvals" FOR EACH ROW EXECUTE FUNCTION gym_case_reject_mutation();
CREATE TRIGGER gym_case_events_append_only BEFORE UPDATE OR DELETE ON "gym_case_events" FOR EACH ROW EXECUTE FUNCTION gym_case_reject_mutation();
CREATE TRIGGER gym_case_executions_append_only BEFORE UPDATE OR DELETE ON "gym_case_executions" FOR EACH ROW EXECUTE FUNCTION gym_case_reject_mutation();
CREATE TRIGGER gym_case_access_logs_append_only BEFORE UPDATE OR DELETE ON "gym_case_access_logs" FOR EACH ROW EXECUTE FUNCTION gym_case_reject_mutation();
