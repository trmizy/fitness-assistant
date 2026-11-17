-- Q9 (additive, no row changes). payment-service tells the withdrawing user when a withdrawal is approved / paid / rejected, and tells the
-- other admins when a large withdrawal (four-eyes) waits for a second admin, through POST /internal/notifications. Without these values
-- every insert would be rejected by the enums.
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'WITHDRAWAL_AWAITING_SECOND_ADMIN';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'WITHDRAWAL_APPROVED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'WITHDRAWAL_PAID';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'WITHDRAWAL_REJECTED';
ALTER TYPE "NotificationEntityType" ADD VALUE IF NOT EXISTS 'WITHDRAWAL_REQUEST';
