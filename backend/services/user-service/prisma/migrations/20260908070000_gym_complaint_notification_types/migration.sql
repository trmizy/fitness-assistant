-- GYM_MANAGEMENT master spec, Phase 5 — lets gym-service notify a complaint's reporter
-- when it's resolved, via the existing generic POST /internal/notifications endpoint.

-- AlterEnum
ALTER TYPE "NotificationEntityType" ADD VALUE 'GYM_COMPLAINT';

-- AlterEnum
ALTER TYPE "NotificationEventType" ADD VALUE 'GYM_COMPLAINT_RESOLVED';
