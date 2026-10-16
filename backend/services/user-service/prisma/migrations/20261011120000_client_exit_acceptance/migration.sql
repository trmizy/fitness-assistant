-- PT-suspension slice 4 (bổ sung 11/10, B): the server's ACCEPTANCE of a client's request to leave a
-- restricted PT's contract without a fee is recorded on the contract, before the money call, so a retry
-- after the PT was reinstated still gets the terms that were accepted. Additive, nullable, no backfill.
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "client_exit_accepted_at" TIMESTAMP(3);
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "client_exit_restriction_id" TEXT;
