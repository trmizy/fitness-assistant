-- FH-8 (evidence): an unpaid obligation can now be UNDER_REVIEW, or PAID_EXTERNALLY with evidence (transfer reference,
-- amount, date, approver, approval ref). Additive only: enum values + nullable/defaulted columns. Existing rows keep their
-- meaning (OPEN = recorded, RESOLVED = legacy "handled elsewhere", WAIVED = not pursued); externally_paid defaults to 0.
-- Nothing here moves money; the event table stays append-only (trigger from 20261020000001).

ALTER TYPE "ContractUnpaidObligationStatus" ADD VALUE IF NOT EXISTS 'UNDER_REVIEW';
ALTER TYPE "ContractUnpaidObligationStatus" ADD VALUE IF NOT EXISTS 'PAID_EXTERNALLY';

ALTER TYPE "ContractUnpaidObligationEventAction" ADD VALUE IF NOT EXISTS 'REVIEW';
ALTER TYPE "ContractUnpaidObligationEventAction" ADD VALUE IF NOT EXISTS 'RELEASE_REVIEW';
ALTER TYPE "ContractUnpaidObligationEventAction" ADD VALUE IF NOT EXISTS 'PAY_EXTERNALLY';

-- Running total of what was paid to the client OUTSIDE this ledger (never a wallet credit). owed = paid + externally_paid + unpaid
-- for rows touched by PAY_EXTERNALLY; `paid` keeps meaning "paid by the ledger".
ALTER TABLE "contract_unpaid_obligations"
  ADD COLUMN "externally_paid" DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE "contract_unpaid_obligation_events"
  ADD COLUMN "paid_amount" DECIMAL(14,2),
  ADD COLUMN "transfer_reference" TEXT,
  ADD COLUMN "paid_on" TIMESTAMP(3),
  ADD COLUMN "approved_by" TEXT,
  ADD COLUMN "unpaid_after" DECIMAL(14,2);
