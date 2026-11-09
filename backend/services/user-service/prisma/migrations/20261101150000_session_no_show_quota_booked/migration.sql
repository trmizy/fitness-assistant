-- Quota A+ (01/11/2026). ADDITIVE ONLY: one nullable column on sessions, no default, no backfill.
--
-- Rule (decided by Ngai): a PT no-show that was validly confirmed (the session reaches the terminal status NO_SHOW while the contract is ACTIVE) consumes ONE entitlement
-- (contracts.compensated_sessions + 1) in the SAME transaction as the status change, under the contract lock, without waiting for payment. This column is the durable per-session
-- mark of that booking: it is set once by a compare-and-set (WHERE no_show_quota_booked_at IS NULL), so the counter moves exactly once however many paths / retries / rows reach it.
--
-- NULL = the quota of this session was NOT booked at the terminal change: every row that existed before this migration, and every no-show of an already-ended contract (historical branch).
-- A settlement row of such a session that is still waiting books the quota the old way, once, when it settles (and sets the mark). Nothing is backfilled and nothing is made up.
ALTER TABLE "sessions" ADD COLUMN "no_show_quota_booked_at" TIMESTAMPTZ(3);
