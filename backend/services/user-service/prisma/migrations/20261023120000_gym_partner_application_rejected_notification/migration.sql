-- B14: the applicant of a gym-partner application is told when the application is rejected. gym-service sends it through
-- POST /internal/notifications (userClient.notifyUser); the event type did not exist, so the insert failed. Additive only.
-- PostgreSQL >= 12 allows ALTER TYPE ... ADD VALUE inside the migration transaction as long as the new
-- values are not used in the same transaction (same pattern as 20261020132616_gym_listing_notification_types).
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'GYM_PARTNER_APPLICATION_REJECTED';
ALTER TYPE "NotificationEntityType" ADD VALUE IF NOT EXISTS 'GYM_PARTNER_APPLICATION';
