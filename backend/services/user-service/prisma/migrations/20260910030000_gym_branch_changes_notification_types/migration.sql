-- GYM_BRANCH_FORM_SPEC.md, Phase 4 — lets gym-service notify a branch owner when admin sends
-- their wizard submission back with "request changes" issues, via the existing generic
-- POST /internal/notifications endpoint.

-- AlterEnum
ALTER TYPE "NotificationEntityType" ADD VALUE 'GYM_BRANCH';

-- AlterEnum
ALTER TYPE "NotificationEventType" ADD VALUE 'GYM_BRANCH_CHANGES_REQUESTED';
