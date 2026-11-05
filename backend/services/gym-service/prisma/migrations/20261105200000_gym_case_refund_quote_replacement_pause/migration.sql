-- DISPUTE V2.1 Slice 3, round 3 (E1 fixed refund quote, E3 decision replacement, E4 deadline pause). ADDITIVE ONLY.
-- Generated DDL (prisma migrate diff, minus the pre-existing member_code drift and the hand-written unique index it wants to drop) + hand-written constraints.

-- AlterTable
ALTER TABLE "gym_case_deadlines" ADD COLUMN     "paused_at" TIMESTAMPTZ(3),
ADD COLUMN     "paused_seconds" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "gym_case_refund_quotes" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "membership_id" TEXT NOT NULL,
    "payment_txn_id" TEXT NOT NULL,
    "quoted_at" TIMESTAMPTZ(3) NOT NULL,
    "price_paid" DECIMAL(12,2) NOT NULL,
    "duration_days" INTEGER NOT NULL,
    "start_date" TIMESTAMPTZ(3),
    "end_date" TIMESTAMPTZ(3),
    "amount" DECIMAL(12,2) NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gym_case_refund_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gym_case_decision_replacements" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "old_approval_id" UUID NOT NULL,
    "proposed_by" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "checks_at_proposal" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by" TEXT,
    "approved_at" TIMESTAMPTZ(3),
    "approval_reason" TEXT,
    "checks_at_approval" JSONB,
    "rejected_by" TEXT,
    "rejected_at" TIMESTAMPTZ(3),
    "rejection_reason" TEXT,

    CONSTRAINT "gym_case_decision_replacements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gym_case_refund_quotes_case_id_key" ON "gym_case_refund_quotes"("case_id");

-- CreateIndex
CREATE INDEX "gym_case_decision_replacements_case_id_created_at_idx" ON "gym_case_decision_replacements"("case_id", "created_at");

-- AddForeignKey
ALTER TABLE "gym_case_refund_quotes" ADD CONSTRAINT "gym_case_refund_quotes_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "gym_complaint_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gym_case_decision_replacements" ADD CONSTRAINT "gym_case_decision_replacements_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "gym_complaint_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gym_case_decision_replacements" ADD CONSTRAINT "gym_case_decision_replacements_old_approval_id_fkey" FOREIGN KEY ("old_approval_id") REFERENCES "gym_case_approvals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Hand-written part ──────────────────────────────────────────────────────────────────────────────────────────────

-- E1: the quote is written once per case, from real data, and is never above what was paid; append-only.
ALTER TABLE "gym_case_refund_quotes" ADD CONSTRAINT "gcrq_amount_range" CHECK ("amount" >= 0 AND "amount" <= "price_paid");
ALTER TABLE "gym_case_refund_quotes" ADD CONSTRAINT "gcrq_price_positive" CHECK ("price_paid" > 0 AND "duration_days" > 0);
CREATE TRIGGER gym_case_refund_quotes_append_only BEFORE UPDATE OR DELETE ON "gym_case_refund_quotes" FOR EACH ROW EXECUTE FUNCTION gym_case_reject_mutation();

-- E3 (same shape as user-service's A4 table): reason present; approval / rejection fields all-or-nothing; not both; four eyes; one live replacement per case.
ALTER TABLE "gym_case_decision_replacements" ADD CONSTRAINT "gcdr_reason_present" CHECK (length(btrim("reason")) > 0);
ALTER TABLE "gym_case_decision_replacements" ADD CONSTRAINT "gcdr_approval_quad" CHECK (("approved_by" IS NULL) = ("approved_at" IS NULL) AND ("approved_by" IS NULL) = ("approval_reason" IS NULL) AND ("approved_by" IS NULL) = ("checks_at_approval" IS NULL));
ALTER TABLE "gym_case_decision_replacements" ADD CONSTRAINT "gcdr_rejection_triple" CHECK (("rejected_by" IS NULL) = ("rejected_at" IS NULL) AND ("rejected_by" IS NULL) = ("rejection_reason" IS NULL));
ALTER TABLE "gym_case_decision_replacements" ADD CONSTRAINT "gcdr_not_both" CHECK ("approved_at" IS NULL OR "rejected_at" IS NULL);
ALTER TABLE "gym_case_decision_replacements" ADD CONSTRAINT "gcdr_four_eyes" CHECK (("approved_by" IS NULL OR "approved_by" <> "proposed_by") AND ("rejected_by" IS NULL OR "rejected_by" <> "proposed_by"));
CREATE UNIQUE INDEX "gcdr_one_live_per_case" ON "gym_case_decision_replacements"("case_id") WHERE "approved_at" IS NULL AND "rejected_at" IS NULL;
-- the row may only be DECIDED once (approved_* / rejected_* set from NULL); nothing else may change and it can never be deleted
CREATE FUNCTION gym_case_replacement_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'gym_case_decision_replacements is append-only'; END IF;
  IF OLD.approved_at IS NOT NULL OR OLD.rejected_at IS NOT NULL THEN RAISE EXCEPTION 'a decided replacement cannot change'; END IF;
  IF NEW.case_id <> OLD.case_id OR NEW.old_approval_id <> OLD.old_approval_id OR NEW.proposed_by <> OLD.proposed_by OR NEW.reason <> OLD.reason OR NEW.checks_at_proposal::text <> OLD.checks_at_proposal::text OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'the proposal part of a replacement cannot change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER gym_case_replacements_guard BEFORE UPDATE OR DELETE ON "gym_case_decision_replacements" FOR EACH ROW EXECUTE FUNCTION gym_case_replacement_guard();

-- E4
ALTER TABLE "gym_case_deadlines" ADD CONSTRAINT "gcd_paused_nonneg" CHECK ("paused_seconds" >= 0);
