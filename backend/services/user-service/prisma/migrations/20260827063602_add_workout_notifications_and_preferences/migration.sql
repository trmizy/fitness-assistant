-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationEntityType" ADD VALUE 'WORKOUT_SCHEDULE';
ALTER TYPE "NotificationEntityType" ADD VALUE 'TRAINING_PROGRAM';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationEventType" ADD VALUE 'WORKOUT_UPCOMING';
ALTER TYPE "NotificationEventType" ADD VALUE 'WORKOUT_RESCHEDULED';
ALTER TYPE "NotificationEventType" ADD VALUE 'WORKOUT_UNFINISHED';
ALTER TYPE "NotificationEventType" ADD VALUE 'TRAINING_PLAN_UPDATED';
ALTER TYPE "NotificationEventType" ADD VALUE 'PT_FEEDBACK_RECEIVED';

-- CreateTable
CREATE TABLE "notification_preferences" (
    "user_id" TEXT NOT NULL,
    "workout_upcoming_enabled" BOOLEAN NOT NULL DEFAULT true,
    "workout_rescheduled_enabled" BOOLEAN NOT NULL DEFAULT true,
    "workout_unfinished_enabled" BOOLEAN NOT NULL DEFAULT true,
    "plan_updated_enabled" BOOLEAN NOT NULL DEFAULT true,
    "pt_feedback_enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id")
);
