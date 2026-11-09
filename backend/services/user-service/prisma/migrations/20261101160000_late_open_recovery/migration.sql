-- Quota & Recovery (01/11/2026). ADDITIVE ONLY: one table, one trigger function.
--
-- RECOVERY after an approved late-open reconciliation exhausted its execution attempts: NOT "retry again". An ADMIN opens a recovery with a reason; the system reads the REAL ledger by the step's own
-- key and stores that observation (immutable) with a classification; a SECOND admin approves (four eyes, conflict of interest); the action then follows the ledger as it is at approval time:
--   REPLAY  the ledger already wrote it (operation under the same key, obligation PAID_VIA_LEDGER)  -> replay the SAME key so the row and bookkeeping catch up; no new money
--   GRANT   the ledger did not write it, the obligation is a clean OPEN and the source is enough   -> a bounded number of extra executions, the SAME idempotency key
--   HALT    unreadable / not clean / inconsistent                                                    -> stop, NEEDS_HUMAN with an explicit code, nothing is run
-- There is no new idempotency key for the money step and no new way to pay. One live recovery per proposal; a limited number of recoveries per proposal (service rule).
CREATE TABLE "late_open_reconciliation_recoveries" (
  "id" UUID NOT NULL,
  "reconciliation_id" UUID NOT NULL,
  "settlement_row_id" TEXT NOT NULL,
  "opened_by" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "classification" TEXT NOT NULL,
  "halt_code" TEXT,
  "observation" JSONB NOT NULL,
  "approved_by" TEXT,
  "approved_at" TIMESTAMPTZ(3),
  "outcome" TEXT,
  "outcome_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "late_open_reconciliation_recoveries_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "late_open_reconciliation_recoveries" ADD CONSTRAINT "lorr_reconciliation_fkey" FOREIGN KEY ("reconciliation_id") REFERENCES "late_open_reconciliations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "late_open_reconciliation_recoveries" ADD CONSTRAINT "lorr_row_fkey" FOREIGN KEY ("settlement_row_id") REFERENCES "session_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "late_open_reconciliation_recoveries" ADD CONSTRAINT "lorr_reason_present" CHECK (length(btrim("reason")) > 0);
ALTER TABLE "late_open_reconciliation_recoveries" ADD CONSTRAINT "lorr_classification" CHECK ("classification" IN ('REPLAY', 'GRANT', 'HALT'));
ALTER TABLE "late_open_reconciliation_recoveries" ADD CONSTRAINT "lorr_halt_code" CHECK (("classification" = 'HALT') = ("halt_code" IS NOT NULL));
ALTER TABLE "late_open_reconciliation_recoveries" ADD CONSTRAINT "lorr_approval_pair" CHECK (("approved_by" IS NULL) = ("approved_at" IS NULL));
ALTER TABLE "late_open_reconciliation_recoveries" ADD CONSTRAINT "lorr_four_eyes" CHECK ("approved_by" IS NULL OR "approved_by" <> "opened_by");
ALTER TABLE "late_open_reconciliation_recoveries" ADD CONSTRAINT "lorr_outcome_pair" CHECK (("outcome" IS NULL) = ("outcome_at" IS NULL));
ALTER TABLE "late_open_reconciliation_recoveries" ADD CONSTRAINT "lorr_outcome_values" CHECK ("outcome" IS NULL OR "outcome" IN ('APPLIED', 'HALTED', 'REJECTED'));
ALTER TABLE "late_open_reconciliation_recoveries" ADD CONSTRAINT "lorr_outcome_vs_approval" CHECK (("outcome" IS DISTINCT FROM 'REJECTED' OR "approved_at" IS NULL) AND ("outcome" NOT IN ('APPLIED', 'HALTED') OR "approved_at" IS NOT NULL));

CREATE INDEX "lorr_reconciliation_idx" ON "late_open_reconciliation_recoveries"("reconciliation_id");
-- ONE live (no outcome yet) recovery per proposal.
CREATE UNIQUE INDEX "lorr_one_live_per_proposal" ON "late_open_reconciliation_recoveries"("reconciliation_id") WHERE "outcome" IS NULL;

-- Append-only with the same two one-time stamps as the proposals (approval, outcome): NULL -> value once, every other column unchanged; any other UPDATE and every DELETE is rejected.
CREATE FUNCTION late_open_recovery_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND ROW(NEW."id", NEW."reconciliation_id", NEW."settlement_row_id", NEW."opened_by", NEW."reason", NEW."classification", NEW."halt_code", NEW."observation", NEW."created_at")
         IS NOT DISTINCT FROM
         ROW(OLD."id", OLD."reconciliation_id", OLD."settlement_row_id", OLD."opened_by", OLD."reason", OLD."classification", OLD."halt_code", OLD."observation", OLD."created_at")
     AND (OLD."approved_at" IS NULL OR ROW(NEW."approved_by", NEW."approved_at") IS NOT DISTINCT FROM ROW(OLD."approved_by", OLD."approved_at"))
     AND (OLD."outcome_at" IS NULL OR ROW(NEW."outcome", NEW."outcome_at") IS NOT DISTINCT FROM ROW(OLD."outcome", OLD."outcome_at"))
     AND ROW(NEW."approved_by", NEW."approved_at", NEW."outcome", NEW."outcome_at") IS DISTINCT FROM ROW(OLD."approved_by", OLD."approved_at", OLD."outcome", OLD."outcome_at") THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER late_open_recovery_append_only
  BEFORE UPDATE OR DELETE ON "late_open_reconciliation_recoveries"
  FOR EACH ROW EXECUTE FUNCTION late_open_recovery_guard();
