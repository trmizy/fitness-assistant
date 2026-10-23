-- Listing Management (gym side): notification types gym-service sends to the owner through
-- POST /internal/notifications (gym-service src/services/gym-listing-notify.ts). Additive only.
-- PostgreSQL >= 12 allows ALTER TYPE ... ADD VALUE inside the migration transaction as long as the new
-- values are not used in the same transaction (same pattern as 20261017173131_pt_listing_revisions).
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'GYM_LISTING_APPROVED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'GYM_LISTING_REJECTED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'GYM_LISTING_CHANGES_REQUESTED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'GYM_LISTING_INVALIDATED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'GYM_AMENITY_PROPOSAL_REVIEWED';
