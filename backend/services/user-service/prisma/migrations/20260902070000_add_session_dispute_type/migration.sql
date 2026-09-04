-- Vòng 4 / Phase E4 — audit/admin-screen classification of a DISPUTED session, does not change
-- resolveDispute's outcomes. Nullable, no backfill: which of the three claims an EXISTING
-- disputed session represents is not reliably recoverable from ptNotes/disputeReason free text
-- alone (unlike Phase E2's ptAtFault, which had exact-string matches to key off).
CREATE TYPE "SessionDisputeType" AS ENUM ('DELIVERY_DISPUTE', 'PT_NO_SHOW_CLAIM', 'CLIENT_NO_SHOW_CLAIM');

ALTER TABLE "sessions" ADD COLUMN "dispute_type" "SessionDisputeType";
