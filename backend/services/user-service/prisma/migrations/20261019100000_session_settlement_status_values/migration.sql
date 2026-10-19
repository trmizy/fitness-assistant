-- FH-3a (Financial Hardening, plan section 2 / FH-3): real settlement states instead of text prefixes in last_error.
-- Part 1 of 2 - the new enum values ONLY. PostgreSQL cannot use a value in the transaction that adds it, so the
-- columns and the backfill that reference them are in the next migration file.
--   UNCONFIRMED  reserved for D65-B (an ending / release whose ledger outcome is not known yet; needs the admin path).
--                Nothing writes it in FH-3a.
--   NEEDS_HUMAN  was: status FAILED + last_error 'NEEDS_RECONCILIATION: ...' (parked for a person).
--   CONFLICT     was: status FAILED + last_error 'CONFLICT: ...' (payment-service answered something else than what was recorded).
-- Additive only (ALTER TYPE ... ADD VALUE): no row is touched, an old binary that never writes these values keeps working.

-- AlterEnum
ALTER TYPE "SessionSettlementStatus" ADD VALUE IF NOT EXISTS 'UNCONFIRMED';
ALTER TYPE "SessionSettlementStatus" ADD VALUE IF NOT EXISTS 'NEEDS_HUMAN';
ALTER TYPE "SessionSettlementStatus" ADD VALUE IF NOT EXISTS 'CONFLICT';
