-- DISPUTE CASE slice 1 hardening (P0): evidence a Client/PT submits about themselves is RESTRICTED and CLIENT_CLAIMED_UNVERIFIED, never shareable.
-- ADDITIVE only (the Slice 1 migration 20261027100000 is not touched): one new enum, one new enum value, one new column with a default.
-- No existing row is rewritten: dispute_case_evidence is append-only (UPDATE is rejected by trigger) and the Slice 1 code never ran outside *_test
-- databases. Rows written before this migration keep sensitivity NORMAL / verification_status NOT_APPLICABLE; the application derives the
-- restricted/unverified treatment of a row from its submitted_role as well, so such a row is protected all the same.

-- CreateEnum
CREATE TYPE "DisputeCaseVerificationStatus" AS ENUM ('CLIENT_CLAIMED_UNVERIFIED', 'SERVER_VERIFIED', 'NOT_APPLICABLE');

-- AlterEnum
ALTER TYPE "DisputeCaseSensitivity" ADD VALUE 'RESTRICTED';

-- AlterTable
ALTER TABLE "dispute_case_evidence" ADD COLUMN "verification_status" "DisputeCaseVerificationStatus" NOT NULL DEFAULT 'NOT_APPLICABLE';

-- Last line of defence for NEW rows: whatever a Client/PT submits is RESTRICTED + CLIENT_CLAIMED_UNVERIFIED. NOT VALID = existing rows are not
-- checked (they cannot be rewritten). The comparison goes through ::text because a value added by ALTER TYPE cannot be used as an enum literal in the
-- same transaction.
ALTER TABLE "dispute_case_evidence" ADD CONSTRAINT "dispute_case_evidence_party_submission_restricted"
  CHECK (
    "submitted_role" IS NULL
    OR "submitted_role" NOT IN ('CLIENT', 'PT')
    OR ("sensitivity"::text = 'RESTRICTED' AND "verification_status"::text = 'CLIENT_CLAIMED_UNVERIFIED')
  ) NOT VALID;
