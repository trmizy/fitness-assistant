-- Client notification when payment-service auto-refunds a LATE payment for an already-cancelled personalized order /
-- gym membership / PT contract (FH-5). Sent through POST /internal/notifications. Additive only.
-- PostgreSQL >= 12 allows ALTER TYPE ... ADD VALUE inside the migration transaction as long as the new
-- values are not used in the same transaction (same pattern as 20261020132616_gym_listing_notification_types).
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'PAYMENT_AUTO_REFUNDED';
ALTER TYPE "NotificationEntityType" ADD VALUE IF NOT EXISTS 'PAYMENT';
