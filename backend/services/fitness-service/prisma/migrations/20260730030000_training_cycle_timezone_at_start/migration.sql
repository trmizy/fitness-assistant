-- Adds a per-cycle snapshot of the IANA timezone in effect when the
-- cycle's startDate was set (creation or DRAFT->ACTIVE activation).
-- Additive, nullable — existing rows are left NULL (unknown/legacy),
-- never backfilled with a guessed value. New code always writes this
-- going forward (see training-cycle.service.ts's startCycle/startDraftCycle).
ALTER TABLE "training_cycles" ADD COLUMN "timezone_at_start" TEXT;
