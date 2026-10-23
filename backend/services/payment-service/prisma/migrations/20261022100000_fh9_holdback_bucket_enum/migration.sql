-- FH-9: the PT financial-holdback bucket. Additive and ONLY the ALTER TYPE: Postgres will not let a freshly added enum value be used
-- in the transaction that added it, so nothing here refers to it. Written by application code after this migration (the column
-- comes in the next one). Precedent: 20260830000002_add_locked_ledger_bucket.
ALTER TYPE "LedgerBucket" ADD VALUE IF NOT EXISTS 'HOLDBACK';
