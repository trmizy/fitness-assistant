-- DISPUTE CASE slice 1 (case management core). Additive only: new enums and dispute_case* tables, nothing existing changes.
-- Generated DDL (prisma migrate diff) followed by the hand-written constraints. No row is created for any existing session.

-- CreateEnum
CREATE TYPE "DisputeCaseType" AS ENUM ('PT_DELIVERY', 'PT_CLIENT_NO_SHOW_CLAIM', 'PT_NO_SHOW_CLAIM');

-- CreateEnum
CREATE TYPE "DisputeCaseStatus" AS ENUM ('INTAKE', 'COLLECTING', 'AWAITING_PARTIES', 'ASSESSING', 'TECH_RECONCILIATION', 'FINDING_RECORDED', 'POLICY_PENDING', 'PROPOSED', 'AWAITING_APPROVAL', 'DECISION_APPROVED', 'REJECTED_INTAKE');

-- CreateEnum
CREATE TYPE "DisputeCaseIssueKind" AS ENUM ('PT_LATE');

-- CreateEnum
CREATE TYPE "DisputeCaseIssueFinding" AS ENUM ('LATE_CONFIRMED_BY_ROOM_DATA', 'LATE_CONTESTED', 'NOT_LATE', 'UNDETERMINED');

-- CreateEnum
CREATE TYPE "DisputeCaseClaimantRole" AS ENUM ('CLIENT', 'PT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "DisputeCaseProvenance" AS ENUM ('SERVER_OBSERVED', 'USER_REPORTED_STORED', 'DERIVED', 'EXTERNAL_DOCUMENT', 'TECH_GAP', 'NOT_APPLICABLE', 'ADMIN_RECEIVED_ON_BEHALF', 'LEGACY_FIELD');

-- CreateEnum
CREATE TYPE "DisputeCaseCaptureStatus" AS ENUM ('OK', 'UNAVAILABLE', 'NOT_APPLICABLE', 'TECH_GAP_SUSPECTED');

-- CreateEnum
CREATE TYPE "DisputeCaseSensitivity" AS ENUM ('NORMAL', 'SENSITIVE');

-- CreateEnum
CREATE TYPE "DisputeCasePartyRole" AS ENUM ('CLIENT', 'PT', 'ADMIN_ON_BEHALF');

-- CreateEnum
CREATE TYPE "DisputeCaseShareRole" AS ENUM ('CLIENT', 'PT');

-- CreateEnum
CREATE TYPE "DisputeCaseAssessmentResult" AS ENUM ('ESTABLISHED', 'NOT_ESTABLISHED', 'REFUTED');

-- CreateEnum
CREATE TYPE "DisputeCaseFindingKind" AS ENUM ('VERIFIED_DELIVERED', 'VERIFIED_CLIENT_ABSENT', 'VERIFIED_PT_ABSENT', 'VERIFIED_NOT_DELIVERED_NO_FAULT', 'INSUFFICIENT_EVIDENCE', 'NOT_A_DISPUTE');

-- CreateEnum
CREATE TYPE "DisputeCaseOutcome" AS ENUM ('COMPLETED', 'CANCELLED', 'PT_NO_SHOW_CONFIRMED');

-- CreateEnum
CREATE TYPE "DisputeCaseApprovalResult" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DisputeCaseAccessAction" AS ENUM ('VIEW_CASE', 'VIEW_EVIDENCE');

-- CreateTable
CREATE TABLE "dispute_cases" (
    "id" UUID NOT NULL,
    "session_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "client_user_id" TEXT NOT NULL,
    "pt_user_id" TEXT NOT NULL,
    "type" "DisputeCaseType" NOT NULL,
    "status" "DisputeCaseStatus" NOT NULL DEFAULT 'INTAKE',
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "investigator_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "dispute_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_case_issues" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "kind" "DisputeCaseIssueKind" NOT NULL,
    "finding" "DisputeCaseIssueFinding" NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "recorded_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_case_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_case_claims" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "claimant_role" "DisputeCaseClaimantRole" NOT NULL,
    "text" TEXT NOT NULL,
    "moves" TEXT[],
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_case_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_case_evidence" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "provenance_type" "DisputeCaseProvenance" NOT NULL,
    "source" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "scope_session_id" TEXT NOT NULL,
    "scope_contract_id" TEXT NOT NULL,
    "event_at" TIMESTAMPTZ(3),
    "captured_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_by" TEXT,
    "submitted_role" TEXT,
    "capture_status" "DisputeCaseCaptureStatus" NOT NULL,
    "snapshot_version" INTEGER NOT NULL DEFAULT 1,
    "content_hash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "sensitivity" "DisputeCaseSensitivity" NOT NULL DEFAULT 'NORMAL',
    "supersedes_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_case_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_case_statements" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "party_role" "DisputeCasePartyRole" NOT NULL,
    "author_user_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "text" TEXT NOT NULL,
    "supplement_reason" TEXT,
    "supersedes_id" UUID,
    "content_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_case_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_case_shares" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "evidence_id" UUID,
    "statement_id" UUID,
    "shared_with_role" "DisputeCaseShareRole" NOT NULL,
    "shared_by" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_case_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_case_assessments" (
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
    "result" "DisputeCaseAssessmentResult" NOT NULL,
    "reasoning" TEXT NOT NULL,
    "evidence_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_case_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_case_findings" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "finding" "DisputeCaseFindingKind" NOT NULL,
    "reasoning" TEXT NOT NULL,
    "recorded_by" TEXT NOT NULL,
    "supersedes_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_case_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_case_proposals" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "finding_id" UUID NOT NULL,
    "outcome" "DisputeCaseOutcome" NOT NULL,
    "proposer_id" TEXT NOT NULL,
    "execution_blocked_reason" TEXT,
    "evidence_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_case_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_case_approvals" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "approver_id" TEXT NOT NULL,
    "result" "DisputeCaseApprovalResult" NOT NULL,
    "reason" TEXT NOT NULL,
    "conflict_of_interest_declared_none" BOOLEAN NOT NULL,
    "evidence_change_acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_case_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_case_events" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "actor_role" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "from_status" "DisputeCaseStatus",
    "to_status" "DisputeCaseStatus",
    "note" TEXT,
    "idempotency_key" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_case_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_case_access_logs" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "viewer_user_id" TEXT NOT NULL,
    "viewer_role" TEXT NOT NULL,
    "evidence_id" UUID,
    "action" "DisputeCaseAccessAction" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_case_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dispute_cases_session_id_idx" ON "dispute_cases"("session_id");

-- CreateIndex
CREATE INDEX "dispute_cases_status_idx" ON "dispute_cases"("status");

-- CreateIndex
CREATE INDEX "dispute_cases_client_user_id_idx" ON "dispute_cases"("client_user_id");

-- CreateIndex
CREATE INDEX "dispute_cases_pt_user_id_idx" ON "dispute_cases"("pt_user_id");

-- CreateIndex
CREATE INDEX "dispute_case_issues_case_id_idx" ON "dispute_case_issues"("case_id");

-- CreateIndex
CREATE INDEX "dispute_case_claims_case_id_idx" ON "dispute_case_claims"("case_id");

-- CreateIndex
CREATE INDEX "dispute_case_evidence_case_id_source_subject_idx" ON "dispute_case_evidence"("case_id", "source", "subject");

-- CreateIndex
CREATE INDEX "dispute_case_statements_case_id_idx" ON "dispute_case_statements"("case_id");

-- CreateIndex
CREATE INDEX "dispute_case_shares_case_id_shared_with_role_idx" ON "dispute_case_shares"("case_id", "shared_with_role");

-- CreateIndex
CREATE INDEX "dispute_case_assessments_case_id_idx" ON "dispute_case_assessments"("case_id");

-- CreateIndex
CREATE INDEX "dispute_case_findings_case_id_idx" ON "dispute_case_findings"("case_id");

-- CreateIndex
CREATE INDEX "dispute_case_proposals_case_id_idx" ON "dispute_case_proposals"("case_id");

-- CreateIndex
CREATE INDEX "dispute_case_approvals_proposal_id_idx" ON "dispute_case_approvals"("proposal_id");

-- CreateIndex
CREATE UNIQUE INDEX "dispute_case_events_idempotency_key_key" ON "dispute_case_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "dispute_case_events_case_id_created_at_idx" ON "dispute_case_events"("case_id", "created_at");

-- CreateIndex
CREATE INDEX "dispute_case_access_logs_case_id_created_at_idx" ON "dispute_case_access_logs"("case_id", "created_at");

-- AddForeignKey
ALTER TABLE "dispute_case_issues" ADD CONSTRAINT "dispute_case_issues_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "dispute_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_case_claims" ADD CONSTRAINT "dispute_case_claims_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "dispute_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_case_evidence" ADD CONSTRAINT "dispute_case_evidence_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "dispute_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_case_statements" ADD CONSTRAINT "dispute_case_statements_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "dispute_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_case_shares" ADD CONSTRAINT "dispute_case_shares_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "dispute_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_case_assessments" ADD CONSTRAINT "dispute_case_assessments_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "dispute_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_case_assessments" ADD CONSTRAINT "dispute_case_assessments_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "dispute_case_claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_case_findings" ADD CONSTRAINT "dispute_case_findings_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "dispute_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_case_proposals" ADD CONSTRAINT "dispute_case_proposals_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "dispute_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_case_proposals" ADD CONSTRAINT "dispute_case_proposals_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "dispute_case_findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_case_approvals" ADD CONSTRAINT "dispute_case_approvals_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "dispute_case_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_case_events" ADD CONSTRAINT "dispute_case_events_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "dispute_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_case_access_logs" ADD CONSTRAINT "dispute_case_access_logs_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "dispute_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Hand-written part: constraints the Prisma schema DSL cannot express ─────────────────────────────────────────────

-- DISPUTE CASE slice 1 (docs/DISPUTE_CASE_DESIGN_V2_1.md §1.6.4): one OPEN case per session. Terminal = DECISION_APPROVED, REJECTED_INTAKE.
CREATE UNIQUE INDEX "dispute_cases_one_open_per_session" ON "dispute_cases"("session_id")
  WHERE "status" NOT IN ('DECISION_APPROVED', 'REJECTED_INTAKE');

ALTER TABLE "dispute_cases" ADD CONSTRAINT "dispute_cases_version_positive" CHECK ("version" >= 1);

-- Statement versions of one party in one case are 1, 2, 3 ... without a gap or a duplicate (the writer computes max+1; a race loses on this index).
CREATE UNIQUE INDEX "dispute_case_statements_unique_version" ON "dispute_case_statements"("case_id", "party_role", "version");
ALTER TABLE "dispute_case_statements" ADD CONSTRAINT "dispute_case_statements_supplement_required"
  CHECK ("version" = 1 OR ("supplement_reason" IS NOT NULL AND length(btrim("supplement_reason")) > 0));

-- A share points at exactly one thing: an evidence row or a statement.
ALTER TABLE "dispute_case_shares" ADD CONSTRAINT "dispute_case_shares_exactly_one_target"
  CHECK (("evidence_id" IS NOT NULL AND "statement_id" IS NULL) OR ("evidence_id" IS NULL AND "statement_id" IS NOT NULL));

-- Four eyes, last line of defence: at most ONE approving decision per proposal, and the conflict-of-interest declaration is always "none".
CREATE UNIQUE INDEX "dispute_case_approvals_one_approved_per_proposal" ON "dispute_case_approvals"("proposal_id")
  WHERE "result" = 'APPROVED';
ALTER TABLE "dispute_case_approvals" ADD CONSTRAINT "dispute_case_approvals_declaration_true"
  CHECK ("conflict_of_interest_declared_none" = true);
ALTER TABLE "dispute_case_approvals" ADD CONSTRAINT "dispute_case_approvals_reason_present"
  CHECK (length(btrim("reason")) > 0);

-- Append-only audit/evidence tables: UPDATE and DELETE are rejected (same pattern as payment-service's fh8_reject_event_mutation; read
-- 20261023100000_fh9_holdback_reviews there). dispute_cases itself is NOT in this list: it changes only through a CAS on `version`.
CREATE FUNCTION dispute_case_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER dispute_case_evidence_append_only
  BEFORE UPDATE OR DELETE ON "dispute_case_evidence"
  FOR EACH ROW EXECUTE FUNCTION dispute_case_reject_mutation();
CREATE TRIGGER dispute_case_statements_append_only
  BEFORE UPDATE OR DELETE ON "dispute_case_statements"
  FOR EACH ROW EXECUTE FUNCTION dispute_case_reject_mutation();
CREATE TRIGGER dispute_case_shares_append_only
  BEFORE UPDATE OR DELETE ON "dispute_case_shares"
  FOR EACH ROW EXECUTE FUNCTION dispute_case_reject_mutation();
CREATE TRIGGER dispute_case_assessments_append_only
  BEFORE UPDATE OR DELETE ON "dispute_case_assessments"
  FOR EACH ROW EXECUTE FUNCTION dispute_case_reject_mutation();
CREATE TRIGGER dispute_case_findings_append_only
  BEFORE UPDATE OR DELETE ON "dispute_case_findings"
  FOR EACH ROW EXECUTE FUNCTION dispute_case_reject_mutation();
CREATE TRIGGER dispute_case_proposals_append_only
  BEFORE UPDATE OR DELETE ON "dispute_case_proposals"
  FOR EACH ROW EXECUTE FUNCTION dispute_case_reject_mutation();
CREATE TRIGGER dispute_case_approvals_append_only
  BEFORE UPDATE OR DELETE ON "dispute_case_approvals"
  FOR EACH ROW EXECUTE FUNCTION dispute_case_reject_mutation();
CREATE TRIGGER dispute_case_events_append_only
  BEFORE UPDATE OR DELETE ON "dispute_case_events"
  FOR EACH ROW EXECUTE FUNCTION dispute_case_reject_mutation();
CREATE TRIGGER dispute_case_access_logs_append_only
  BEFORE UPDATE OR DELETE ON "dispute_case_access_logs"
  FOR EACH ROW EXECUTE FUNCTION dispute_case_reject_mutation();
