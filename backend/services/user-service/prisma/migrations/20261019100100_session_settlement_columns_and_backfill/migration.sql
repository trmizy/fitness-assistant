-- FH-3a part 2 of 2: columns + index + backfill of the statuses added by the previous migration.
-- Additive only: every new column is nullable, no existing column / row semantics change except the backfill below.
--   request_snapshot  the immutable request recorded together with the intent (what the money step was decided for)
--   result            payment-service's stored answer (reserved; written by the later FH steps)
--   applied_at        when the sub-ledger bookkeeping of the answer was applied (reserved)
--   conflict_note     why a CONFLICT row is a conflict (the text that also stays in last_error)
--   next_attempt_at   persisted back-off (reserved; the sweep still derives its back-off from attempts/updated_at)
ALTER TABLE "session_settlements"
  ADD COLUMN "request_snapshot" JSONB,
  ADD COLUMN "result"           JSONB,
  ADD COLUMN "applied_at"       TIMESTAMPTZ(3),
  ADD COLUMN "conflict_note"    TEXT,
  ADD COLUMN "next_attempt_at"  TIMESTAMPTZ(3);

CREATE INDEX "session_settlements_status_next_attempt_at_idx" ON "session_settlements"("status", "next_attempt_at");

-- Backfill: a parked row used to be 'FAILED' + a text prefix. last_error keeps its text (the prefix is still written by the
-- code), only the status becomes the real one. 'ENDED_UNSETTLED:' (terminal orphan label) stays exactly as it is.
-- Safe to run again: it only touches rows that are still FAILED with the prefix (e.g. rows an older instance parked during a
-- rolling deploy).
UPDATE "session_settlements"
   SET "status" = 'NEEDS_HUMAN'::"SessionSettlementStatus"
 WHERE "status" = 'FAILED' AND "last_error" LIKE 'NEEDS\_RECONCILIATION:%';

UPDATE "session_settlements"
   SET "status" = 'CONFLICT'::"SessionSettlementStatus",
       "conflict_note" = "last_error"
 WHERE "status" = 'FAILED' AND "last_error" LIKE 'CONFLICT:%';
