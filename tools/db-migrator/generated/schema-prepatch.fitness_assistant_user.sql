-- ===== DATABASE: fitness_assistant_user (service: user-service) =====
-- Safe to re-run: every statement below is CREATE ... IF NOT EXISTS,
-- ADD COLUMN IF NOT EXISTS, or a duplicate_object-guarded CREATE TYPE.

-- [fitness_assistant_user] AlterEnum
ALTER TYPE "NotificationEntityType" ADD VALUE IF NOT EXISTS 'WORKOUT_SCHEDULE';
ALTER TYPE "NotificationEntityType" ADD VALUE IF NOT EXISTS 'TRAINING_PROGRAM';
ALTER TYPE "NotificationEntityType" ADD VALUE IF NOT EXISTS 'NUTRITION_PROGRAM';
ALTER TYPE "NotificationEntityType" ADD VALUE IF NOT EXISTS 'TRAINING_CYCLE';
ALTER TYPE "NotificationEntityType" ADD VALUE IF NOT EXISTS 'GYM_COMPLAINT';
ALTER TYPE "NotificationEntityType" ADD VALUE IF NOT EXISTS 'GYM_BRANCH';

-- [fitness_assistant_user] AlterEnum
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'WORKOUT_UPCOMING';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'WORKOUT_RESCHEDULED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'WORKOUT_UNFINISHED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'TRAINING_PLAN_UPDATED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'PT_FEEDBACK_RECEIVED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'NUTRITION_PLAN_READY';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'CYCLE_REASSESSMENT_READY';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'GYM_COMPLAINT_RESOLVED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'GYM_BRANCH_CHANGES_REQUESTED';

-- [fitness_assistant_user] AlterEnum
ALTER TYPE "SessionSettlementKind" ADD VALUE IF NOT EXISTS 'PT_LATE_ARRIVAL_COMPENSATION';

-- [fitness_assistant_user] AlterEnum
ALTER TYPE "TerminationReason" ADD VALUE IF NOT EXISTS 'PT_REPEATED_NO_SHOW';

-- [fitness_assistant_user] Enum data drift: "NotificationEntityType" — value(s) found in dump COPY data
-- (columns: notifications.entity_type) but absent from Aurora's live enum. This is data
-- drift, not schema drift — the value may predate the current migrations.
-- Additive and required for pg_restore of this dump to succeed.
ALTER TYPE "NotificationEntityType" ADD VALUE IF NOT EXISTS 'NUTRITION_PROGRAM';
ALTER TYPE "NotificationEntityType" ADD VALUE IF NOT EXISTS 'TRAINING_CYCLE';
ALTER TYPE "NotificationEntityType" ADD VALUE IF NOT EXISTS 'TRAINING_PROGRAM';
ALTER TYPE "NotificationEntityType" ADD VALUE IF NOT EXISTS 'WORKOUT_SCHEDULE';

-- [fitness_assistant_user] Enum data drift: "NotificationEventType" — value(s) found in dump COPY data
-- (columns: notifications.event_type) but absent from Aurora's live enum. This is data
-- drift, not schema drift — the value may predate the current migrations.
-- Additive and required for pg_restore of this dump to succeed.
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'CYCLE_REASSESSMENT_READY';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'NUTRITION_PLAN_READY';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'PT_FEEDBACK_RECEIVED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'TRAINING_PLAN_UPDATED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'WORKOUT_RESCHEDULED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'WORKOUT_UNFINISHED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'WORKOUT_UPCOMING';

