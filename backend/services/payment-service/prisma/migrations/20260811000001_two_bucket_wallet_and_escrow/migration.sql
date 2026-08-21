-- Two-bucket wallets + the ESCROW / REVENUE split.
--
-- Data safety: no existing balance moves. Every đồng a wallet holds today is money its owner
-- may already withdraw, so it all stays in available_balance and pending_balance starts at 0.
-- Existing ledger rows are stamped AVAILABLE for the same reason.

CREATE TYPE "LedgerBucket" AS ENUM ('PENDING', 'AVAILABLE');

ALTER TABLE "wallets"
  ADD COLUMN "pending_balance" DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE "wallet_ledger_entries"
  ADD COLUMN "bucket" "LedgerBucket" NOT NULL DEFAULT 'AVAILABLE';

-- The single mixed PLATFORM wallet becomes the REVENUE wallet: everything it holds today is
-- commission the platform actually earned on completed purchases, never custodial money.
UPDATE "wallets"
   SET "owner_id" = 'REVENUE'
 WHERE "owner_type" = 'PLATFORM' AND "owner_id" = 'PLATFORM';

-- Seed ESCROW with the total of every other wallet. This is not invented money: each of those
-- balances arrived through a gateway top-up, so the platform genuinely holds that cash and is
-- custodian of it. Seeding it is what makes the reconciliation invariant hold from day one
-- instead of reporting a permanent legacy drift.
INSERT INTO "wallets" ("id", "owner_type", "owner_id", "available_balance", "pending_balance", "locked_balance", "status", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  'PLATFORM',
  'ESCROW',
  COALESCE((SELECT SUM("available_balance") FROM "wallets"), 0),
  0,
  0,
  'ACTIVE',
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "wallets" WHERE "owner_type" = 'PLATFORM' AND "owner_id" = 'ESCROW'
);

-- A bucket's history is read per wallet per bucket; the old index cannot serve that.
CREATE INDEX "wallet_ledger_entries_wallet_id_bucket_created_at_idx"
  ON "wallet_ledger_entries" ("wallet_id", "bucket", "created_at");
