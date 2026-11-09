-- DISPUTE CASE slice 2 / S2.3 (additive). Two new evidence provenance values for the gym check-ins read from gym-service (owner decision 30/10):
--   SELF_REPORTED_SERVER_RECORDED   the person scanned the gym QR themselves; the server only recorded it (member check-in, PT check-in)
--   STAFF_ATTESTED_SERVER_RECORDED  a staff member checked the person in on their behalf (assisted check-in); the staff identity check is recorded in the payload
-- Neither is SERVER_OBSERVED: the server did not witness the person being at the gym, it stored a scan / an attestation. Adding enum values only: no row changes.
ALTER TYPE "DisputeCaseProvenance" ADD VALUE IF NOT EXISTS 'SELF_REPORTED_SERVER_RECORDED';
ALTER TYPE "DisputeCaseProvenance" ADD VALUE IF NOT EXISTS 'STAFF_ATTESTED_SERVER_RECORDED';
