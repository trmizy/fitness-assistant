-- DISPUTE CASE slice 2 / S2.8 (additive, applied AFTER 20261030100000_dispute_case_execution, whose bytes must stay as they were applied).
-- the Slice 1 hardening constraint said "whatever a Client/PT submits is RESTRICTED + CLIENT_CLAIMED_UNVERIFIED". A file the SERVER stored and hashed
-- (dev / test evidence storage) is SERVER_VERIFIED - for the FILE BYTES only, and the row stays RESTRICTED. The new branch demands the marker the service
-- writes (payload.storedFile: serverVerified true, scope FILE_BYTES_ONLY, a 64-hex sha256), so a plain "I declare it is verified" row is still refused.
ALTER TABLE "dispute_case_evidence" DROP CONSTRAINT "dispute_case_evidence_party_submission_restricted";
ALTER TABLE "dispute_case_evidence" ADD CONSTRAINT "dispute_case_evidence_party_submission_restricted"
  CHECK (
    "submitted_role" IS NULL
    OR "submitted_role" NOT IN ('CLIENT', 'PT')
    OR ("sensitivity"::text = 'RESTRICTED' AND "verification_status"::text = 'CLIENT_CLAIMED_UNVERIFIED')
    OR COALESCE(
      "sensitivity"::text = 'RESTRICTED'
      AND "verification_status"::text = 'SERVER_VERIFIED'
      AND "payload" #>> '{storedFile,serverVerified}' = 'true'
      AND "payload" #>> '{storedFile,scope}' = 'FILE_BYTES_ONLY'
      AND "payload" #>> '{storedFile,sha256}' ~ '^[0-9a-f]{64}$',
      false -- a missing marker is NULL, and a CHECK accepts NULL: it must count as "no"
    )
  ) NOT VALID;
