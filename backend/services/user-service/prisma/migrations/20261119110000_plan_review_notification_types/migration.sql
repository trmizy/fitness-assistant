-- Workout Plan Review & Approval notifications (additive, backward compatible).
-- Enum values (PG >= 12 allows ADD VALUE inside the migration transaction as long as the new value is not USED in it).
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'PLAN_REVIEW_REQUESTED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'PLAN_REVIEW_DECIDED';
ALTER TYPE "NotificationEntityType" ADD VALUE IF NOT EXISTS 'PLAN_REVIEW';

-- Idempotency key for at-least-once producers. Nullable + unique: existing rows/producers are unaffected.
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "dedupe_key" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_dedupe_key_key" ON "notifications"("dedupe_key");
