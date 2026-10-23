-- FH-2b: let a ledger operation remember WHAT it was asked to do, so the same business key with
-- different immutable parameters can be refused instead of silently replaying the first result.
-- Additive and nullable: every existing row keeps NULL and replays exactly as before.
ALTER TABLE "ledger_operations"
  ADD COLUMN "request_fingerprint" TEXT,
  ADD COLUMN "transaction_id" TEXT,
  ADD COLUMN "kind" TEXT;

CREATE INDEX "ledger_operations_transaction_id_idx" ON "ledger_operations"("transaction_id");
