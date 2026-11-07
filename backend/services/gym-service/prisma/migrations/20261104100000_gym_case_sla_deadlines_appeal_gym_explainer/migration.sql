-- DISPUTE V2.1 Slice 3, round 2 (A1 SLA / response deadlines / appeal, C10 Gym explainer role, B1 payout hold). ADDITIVE ONLY.
-- Generated DDL (prisma migrate diff, minus the unrelated pre-existing member_code drift and the hand-written unique index it wants to drop) followed by the
-- hand-written constraints. No existing row changes.

-- AlterEnum
ALTER TYPE "GymCaseStatus" ADD VALUE 'APPEAL_REVIEW';

-- AlterTable
ALTER TABLE "gym_complaint_cases" ADD COLUMN     "sla_overdue_at" TIMESTAMPTZ(3),
ADD COLUMN     "sla_warned_at" TIMESTAMPTZ(3);


-- CreateTable
CREATE TABLE "gym_case_notices" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "recipient_user_id" TEXT NOT NULL,
    "recipient_role" TEXT NOT NULL,
    "delivered" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gym_case_notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gym_case_deadlines" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "party_role" "GymCasePartyRole" NOT NULL,
    "recipient_user_id" TEXT NOT NULL,
    "notice_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gym_case_deadlines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gym_case_appeals" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "filed_by" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "notice_at" TIMESTAMPTZ(3),
    "filed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'FILED',
    "reviewer_id" TEXT,
    "assigned_at" TIMESTAMPTZ(3),
    "reviewed_finding_id" UUID NOT NULL,

    CONSTRAINT "gym_case_appeals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gym_case_notices_case_id_kind_idx" ON "gym_case_notices"("case_id", "kind");

-- CreateIndex
CREATE INDEX "gym_case_deadlines_case_id_status_idx" ON "gym_case_deadlines"("case_id", "status");

-- CreateIndex
CREATE INDEX "gym_case_deadlines_status_due_at_idx" ON "gym_case_deadlines"("status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "gym_case_appeals_case_id_key" ON "gym_case_appeals"("case_id");

-- AddForeignKey
ALTER TABLE "gym_case_notices" ADD CONSTRAINT "gym_case_notices_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "gym_complaint_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gym_case_deadlines" ADD CONSTRAINT "gym_case_deadlines_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "gym_complaint_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gym_case_appeals" ADD CONSTRAINT "gym_case_appeals_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "gym_complaint_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Hand-written part ──────────────────────────────────────────────────────────────────────────────────────────────

-- C10 (Ngài approved): the Gym's role in a Gym Case is EVIDENCE + EXPLANATION only, within its branch scope. Lifting the lock on STATEMENTS and SHARES lets the Gym
-- write an explanation and be shown shared material. The lock on CLAIMS stays (a claim is an accusation / assertion the investigator records, never the Gym's), and
-- the Gym still cannot assess, propose, approve, execute or appeal: those are admin / member actions with their own checks.
ALTER TABLE "gym_case_statements" DROP CONSTRAINT "gym_case_statements_gym_party_locked";
ALTER TABLE "gym_case_shares" DROP CONSTRAINT "gym_case_shares_gym_party_locked";

ALTER TABLE "gym_case_notices" ADD CONSTRAINT "gym_case_notices_kind_present" CHECK (length(btrim("kind")) > 0);

-- Deadlines are only ever for the MEMBER or the GYM, of two kinds, in three states.
ALTER TABLE "gym_case_deadlines" ADD CONSTRAINT "gym_case_deadlines_party" CHECK ("party_role" IN ('MEMBER', 'GYM'));
ALTER TABLE "gym_case_deadlines" ADD CONSTRAINT "gym_case_deadlines_kind" CHECK ("kind" IN ('FIRST_RESPONSE', 'SUPPLEMENT_ROUND'));
ALTER TABLE "gym_case_deadlines" ADD CONSTRAINT "gym_case_deadlines_status" CHECK ("status" IN ('OPEN', 'MET', 'EXPIRED', 'CANCELLED'));
ALTER TABLE "gym_case_deadlines" ADD CONSTRAINT "gym_case_deadlines_due_after_start" CHECK ("due_at" > "starts_at");
-- one OPEN deadline per case, party and kind-round at a time
CREATE UNIQUE INDEX "gym_case_deadlines_one_open_per_party" ON "gym_case_deadlines"("case_id", "party_role") WHERE "status" = 'OPEN';

ALTER TABLE "gym_case_appeals" ADD CONSTRAINT "gym_case_appeals_status" CHECK ("status" IN ('FILED', 'REVIEWING', 'DECIDED'));
ALTER TABLE "gym_case_appeals" ADD CONSTRAINT "gym_case_appeals_reason_present" CHECK (length(btrim("reason")) > 0);
-- the reviewer is never the person who filed
ALTER TABLE "gym_case_appeals" ADD CONSTRAINT "gym_case_appeals_reviewer_not_filer" CHECK ("reviewer_id" IS NULL OR "reviewer_id" <> "filed_by");

CREATE TRIGGER gym_case_notices_append_only BEFORE UPDATE OR DELETE ON "gym_case_notices" FOR EACH ROW EXECUTE FUNCTION gym_case_reject_mutation();
