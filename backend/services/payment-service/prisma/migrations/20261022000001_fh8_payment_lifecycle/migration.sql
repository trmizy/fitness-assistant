-- FH-8 (payment lifecycle): an unpaid obligation is "paid" ONLY after an authorised approval, a payment made outside the ledger,
-- evidence recorded by one person and VERIFIED by a DIFFERENT person. Additive only: new enum values, nullable/defaulted columns,
-- one new table. Existing rows keep their meaning and are NOT rewritten:
--   * PAID_EXTERNALLY rows (first-cut "evidence recorded") stay PAID_EXTERNALLY and are shown as "evidence recorded, NOT verified";
--     they are never upgraded to verified, verified_paid stays 0 for them.
--   * RESOLVED / WAIVED / OPEN / UNDER_REVIEW unchanged.
-- Nothing here moves money (no wallet / ledger / receivable table is touched).

ALTER TYPE "ContractUnpaidObligationStatus" ADD VALUE IF NOT EXISTS 'APPROVED_FOR_PAYMENT';
ALTER TYPE "ContractUnpaidObligationStatus" ADD VALUE IF NOT EXISTS 'AWAITING_EVIDENCE';
ALTER TYPE "ContractUnpaidObligationStatus" ADD VALUE IF NOT EXISTS 'PAID_VERIFIED';
ALTER TYPE "ContractUnpaidObligationStatus" ADD VALUE IF NOT EXISTS 'RESOLVED_OTHER';

ALTER TYPE "ContractUnpaidObligationEventAction" ADD VALUE IF NOT EXISTS 'APPROVE_PAYMENT';
ALTER TYPE "ContractUnpaidObligationEventAction" ADD VALUE IF NOT EXISTS 'SUBMIT_EVIDENCE';
ALTER TYPE "ContractUnpaidObligationEventAction" ADD VALUE IF NOT EXISTS 'VERIFY_PAYMENT';
ALTER TYPE "ContractUnpaidObligationEventAction" ADD VALUE IF NOT EXISTS 'CANCEL_APPROVAL';
ALTER TYPE "ContractUnpaidObligationEventAction" ADD VALUE IF NOT EXISTS 'RESOLVE_OTHER';

ALTER TABLE "contract_unpaid_obligations"
  ADD COLUMN "verified_paid" DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE "contract_unpaid_obligation_events"
  ADD COLUMN "payment_id" TEXT,
  ADD COLUMN "payment_source" TEXT,
  ADD COLUMN "recipient" TEXT,
  ADD COLUMN "evidence_ref" TEXT,
  ADD COLUMN "evidence_hash" TEXT,
  ADD COLUMN "bank_statement_id" TEXT,
  ADD COLUMN "verified_by" TEXT;

CREATE TYPE "ContractUnpaidObligationPaymentStatus" AS ENUM ('APPROVED', 'EVIDENCE_SUBMITTED', 'VERIFIED', 'CANCELLED');

CREATE TABLE "contract_unpaid_obligation_payments" (
    "id" TEXT NOT NULL,
    "obligation_id" TEXT NOT NULL,
    "approval_ref" TEXT NOT NULL,
    "status" "ContractUnpaidObligationPaymentStatus" NOT NULL DEFAULT 'APPROVED',
    "amount" DECIMAL(14,2) NOT NULL,
    "payment_source" TEXT NOT NULL,
    "recipient_party" TEXT NOT NULL,
    "recipient_id" TEXT,
    "approved_by" TEXT NOT NULL,
    "approved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_amount" DECIMAL(14,2),
    "transfer_reference" TEXT,
    "paid_on" TIMESTAMP(3),
    "evidence_ref" TEXT,
    "evidence_hash" TEXT,
    "bank_statement_id" TEXT,
    "recorded_by" TEXT,
    "recorded_at" TIMESTAMP(3),
    "verified_by" TEXT,
    "verified_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,

    CONSTRAINT "contract_unpaid_obligation_payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "contract_unpaid_obligation_payments_amount_positive" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "contract_unpaid_obligation_payments_obligation_id_approval_ref_key"
  ON "contract_unpaid_obligation_payments"("obligation_id", "approval_ref");
CREATE INDEX "contract_unpaid_obligation_payments_obligation_id_idx" ON "contract_unpaid_obligation_payments"("obligation_id");

-- At most ONE payment in flight per obligation: a second approval while one is pending is refused by the database itself.
CREATE UNIQUE INDEX "contract_unpaid_obligation_payments_one_open_idx"
  ON "contract_unpaid_obligation_payments"("obligation_id") WHERE "status" IN ('APPROVED', 'EVIDENCE_SUBMITTED');

ALTER TABLE "contract_unpaid_obligation_payments"
  ADD CONSTRAINT "contract_unpaid_obligation_payments_obligation_id_fkey"
  FOREIGN KEY ("obligation_id") REFERENCES "contract_unpaid_obligations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Payment records are never deleted, their identity (what was approved, for whom, from which source) never changes, and the
-- status only moves forward: APPROVED -> EVIDENCE_SUBMITTED -> VERIFIED, or APPROVED / EVIDENCE_SUBMITTED -> CANCELLED.
CREATE FUNCTION fh8_guard_obligation_payment() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% rows are never deleted', TG_TABLE_NAME;
  END IF;
  IF NEW.obligation_id IS DISTINCT FROM OLD.obligation_id
     OR NEW.approval_ref IS DISTINCT FROM OLD.approval_ref
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.payment_source IS DISTINCT FROM OLD.payment_source
     OR NEW.recipient_party IS DISTINCT FROM OLD.recipient_party
     OR NEW.recipient_id IS DISTINCT FROM OLD.recipient_id
     OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
     OR NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
    RAISE EXCEPTION 'approved payment terms are immutable';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'APPROVED' AND NEW.status IN ('EVIDENCE_SUBMITTED', 'CANCELLED'))
    OR (OLD.status = 'EVIDENCE_SUBMITTED' AND NEW.status IN ('VERIFIED', 'CANCELLED'))) THEN
    RAISE EXCEPTION 'illegal payment status transition % -> %', OLD.status, NEW.status;
  END IF;
  IF OLD.status IN ('VERIFIED', 'CANCELLED') THEN
    RAISE EXCEPTION 'a % payment is final', OLD.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contract_unpaid_obligation_payments_guard
  BEFORE UPDATE OR DELETE ON "contract_unpaid_obligation_payments"
  FOR EACH ROW EXECUTE FUNCTION fh8_guard_obligation_payment();
