-- FH-9: the running balance of the HOLDBACK bucket. Additive; every existing wallet gets 0, so a ledger that never holds anything back
-- (every contract today: the holdback rate of every existing contract is 0) is byte-for-byte what it was.
ALTER TABLE "wallets" ADD COLUMN "holdback_balance" DECIMAL(14,2) NOT NULL DEFAULT 0;
