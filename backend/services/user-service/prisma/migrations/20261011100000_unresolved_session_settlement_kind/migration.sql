-- PT-suspension slice 4 (bổ sung 11/10): a client who leaves a restricted PT's contract while a session is
-- awaiting their confirmation (or disputed) does not get that session refunded away; its money stays held and
-- is settled when the session is decided. That settlement is tracked and retried like every other session
-- money step, as a new kind of the existing session_settlements row. Additive only, ALTER TYPE only (a new enum
-- value cannot be used in the transaction that adds it).

-- AlterEnum
ALTER TYPE "SessionSettlementKind" ADD VALUE IF NOT EXISTS 'UNRESOLVED_SESSION_RESOLUTION';
