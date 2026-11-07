-- DISPUTE CASE slice 1 hardening (P1): a DISPUTED session with a NULL dispute_type may be taken in as a provisional LEGACY_UNCLASSIFIED case.
-- ADDITIVE only: one new enum value. sessions.dispute_type is never written by the case code.

-- AlterEnum
ALTER TYPE "DisputeCaseType" ADD VALUE 'LEGACY_UNCLASSIFIED';
