-- 22/11/2026 (owner decision, Gym Owner security handoff item 1). ADDITIVE ONLY: two nullable columns, no row touched, no default, no index.
--   requested_by_user_id  WHO asked for the withdrawal. NULL for every row created before this migration and for PT / CLIENT rows (there the requester is owner_id).
--                         A GYM wallet's owner_id is a branch id, so for GYM rows this is the only record of the person.
--   payout_source         'REGISTERED_ACCOUNT' when the server copied payout_info from the partner's registered payout account (GYM withdrawals); NULL when typed by the requester.
ALTER TABLE "withdrawal_requests" ADD COLUMN IF NOT EXISTS "requested_by_user_id" TEXT;
ALTER TABLE "withdrawal_requests" ADD COLUMN IF NOT EXISTS "payout_source" TEXT;
