-- FH-1 (D48 / N7): durable record of what a PT-fault step could not pay out of the contract's OWN money.
-- Additive only: a new enum pair and a new table. Nothing existing is altered.
CREATE TYPE "ContractUnpaidObligationKind" AS ENUM ('NO_SHOW', 'LATE_ARRIVAL', 'REFUND_SHORT', 'OVER_RELEASED');
CREATE TYPE "ContractUnpaidObligationStatus" AS ENUM ('OPEN', 'RESOLVED', 'WAIVED');

CREATE TABLE "contract_unpaid_obligations" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "contract_ref" TEXT,
    "kind" "ContractUnpaidObligationKind" NOT NULL,
    "party" TEXT NOT NULL,
    "owed" DECIMAL(14,2) NOT NULL,
    "paid" DECIMAL(14,2) NOT NULL,
    "unpaid" DECIMAL(14,2) NOT NULL,
    "status" "ContractUnpaidObligationStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "resolved_note" TEXT,

    CONSTRAINT "contract_unpaid_obligations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contract_unpaid_obligations_key_key" ON "contract_unpaid_obligations"("key");
CREATE INDEX "contract_unpaid_obligations_status_idx" ON "contract_unpaid_obligations"("status");
CREATE INDEX "contract_unpaid_obligations_transaction_id_idx" ON "contract_unpaid_obligations"("transaction_id");

-- Same FK as wallet_ledger_entries: an obligation always belongs to a real payment transaction.
ALTER TABLE "contract_unpaid_obligations"
  ADD CONSTRAINT "contract_unpaid_obligations_transaction_id_fkey"
  FOREIGN KEY ("transaction_id") REFERENCES "payment_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
