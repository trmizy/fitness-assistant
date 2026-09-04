-- P0 cluster F — Wallet.lockedBalance has existed since money-flow plan 5.3 but nothing ever
-- wrote a ledger entry against it. This lets WalletLedgerEntry.bucket record a LOCKED move.
ALTER TYPE "LedgerBucket" ADD VALUE 'LOCKED';
