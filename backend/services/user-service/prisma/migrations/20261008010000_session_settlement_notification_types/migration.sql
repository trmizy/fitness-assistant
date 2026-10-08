-- Notification types the code was already sending but the enum never had: every insert failed
-- and the caller swallowed the error, so session-settlement, dispute and trainer-deactivation
-- notices were never stored or pushed. Also lets a trainer-application result be stored in the
-- applicant's notification list instead of only being pushed live.

-- AlterEnum
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'SESSION_PENDING_CONFIRMATION';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'SESSION_AUTO_CONFIRMED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'SESSION_DISPUTED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'SESSION_DISPUTE_RESOLVED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'SESSION_PT_NO_SHOW_REPORTED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'CONTRACT_CANCELLED_PT_DEACTIVATED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'REFUND_NEEDS_MANUAL_SETTLEMENT';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'PT_APPLICATION_REVIEWED';

-- AlterEnum
ALTER TYPE "NotificationEntityType" ADD VALUE IF NOT EXISTS 'PT_APPLICATION';
