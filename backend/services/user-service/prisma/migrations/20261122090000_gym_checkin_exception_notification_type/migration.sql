-- SECURITY_BUSINESS_HANDOFF item 6 (additive, no row changes). gym-service tells a branch's owner (and the managers scoped to that branch) through
-- POST /internal/notifications (entity GYM_BRANCH, entityId = the branch id) when a front-desk check-in EXCEPTION is requested and waits for approval.
-- Without this value every insert would be rejected by the enum.
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'GYM_CHECKIN_EXCEPTION_REQUESTED';
