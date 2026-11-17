-- FIX3-NOTIFY (15/11/2026, additive, no row changes). gym-service tells a branch's owner (and the managers scoped to that branch) through
-- POST /internal/notifications (entity GYM_BRANCH, entityId = the branch id) when an admin suspends it, lifts the suspension, temporarily closes it
-- or reopens it. Without these values every insert would be rejected by the enum.
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'GYM_BRANCH_SUSPENDED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'GYM_BRANCH_SUSPENSION_LIFTED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'GYM_BRANCH_TEMPORARILY_CLOSED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'GYM_BRANCH_REOPENED';
