-- PT-lock slice 1: durable ordering of lock/unlock commands.
--
-- auth-service numbers every lock/unlock command it relays (PtDeactivationCall.seq). The receiver
-- keeps the number of the last command it applied, next to the flag it controls, so "apply only if
-- newer" is ONE atomic UPDATE ... WHERE (pt_lock_seq IS NULL OR pt_lock_seq <= $seq). A lock that
-- arrives late, or is retried by the relay sweep after an unlock, matches zero rows and is ignored.
-- Additive and nullable: existing rows are untouched and mean "no command received yet".
ALTER TABLE "user_profiles" ADD COLUMN "pt_lock_seq" BIGINT;
