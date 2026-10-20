-- FH-8: audited, idempotent adjustment of partner receivables and unpaid obligations.
-- Additive only. Existing rows keep their meaning: suspended_* are NULL (= collected as before) and waived = 0.
-- No money is moved by anything in this migration; the event tables are append-only audit trails.

ALTER TABLE "partner_receivables"
  ADD COLUMN "suspended_at" TIMESTAMP(3),
  ADD COLUMN "suspended_by" TEXT,
  ADD COLUMN "suspension_reason" TEXT,
  ADD COLUMN "suspension_ref" TEXT,
  ADD COLUMN "waived" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "waived_at" TIMESTAMP(3),
  ADD COLUMN "waived_by" TEXT,
  ADD COLUMN "waive_reason" TEXT,
  ADD COLUMN "waive_ref" TEXT;

CREATE TYPE "PartnerReceivableEventAction" AS ENUM ('SUSPEND', 'RESUME', 'WAIVE');
CREATE TYPE "ContractUnpaidObligationEventAction" AS ENUM ('RESOLVE', 'WAIVE');

CREATE TABLE "partner_receivable_events" (
    "id" TEXT NOT NULL,
    "receivable_id" TEXT NOT NULL,
    "action" "PartnerReceivableEventAction" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "approved_by" TEXT NOT NULL,
    "approval_ref" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "before_json" JSONB NOT NULL,
    "after_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_receivable_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "partner_receivable_events_idempotency_key_key" ON "partner_receivable_events"("idempotency_key");
CREATE INDEX "partner_receivable_events_receivable_id_idx" ON "partner_receivable_events"("receivable_id");

ALTER TABLE "partner_receivable_events"
  ADD CONSTRAINT "partner_receivable_events_receivable_id_fkey"
  FOREIGN KEY ("receivable_id") REFERENCES "partner_receivables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "contract_unpaid_obligation_events" (
    "id" TEXT NOT NULL,
    "obligation_id" TEXT NOT NULL,
    "action" "ContractUnpaidObligationEventAction" NOT NULL,
    "note" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "approval_ref" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "from_status" "ContractUnpaidObligationStatus" NOT NULL,
    "to_status" "ContractUnpaidObligationStatus" NOT NULL,
    "unpaid" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_unpaid_obligation_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contract_unpaid_obligation_events_idempotency_key_key" ON "contract_unpaid_obligation_events"("idempotency_key");
CREATE INDEX "contract_unpaid_obligation_events_obligation_id_idx" ON "contract_unpaid_obligation_events"("obligation_id");

ALTER TABLE "contract_unpaid_obligation_events"
  ADD CONSTRAINT "contract_unpaid_obligation_events_obligation_id_fkey"
  FOREIGN KEY ("obligation_id") REFERENCES "contract_unpaid_obligations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only: refuse UPDATE and DELETE on both event tables at the database level.
CREATE FUNCTION fh8_reject_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER partner_receivable_events_append_only
  BEFORE UPDATE OR DELETE ON "partner_receivable_events"
  FOR EACH ROW EXECUTE FUNCTION fh8_reject_event_mutation();

CREATE TRIGGER contract_unpaid_obligation_events_append_only
  BEFORE UPDATE OR DELETE ON "contract_unpaid_obligation_events"
  FOR EACH ROW EXECUTE FUNCTION fh8_reject_event_mutation();
