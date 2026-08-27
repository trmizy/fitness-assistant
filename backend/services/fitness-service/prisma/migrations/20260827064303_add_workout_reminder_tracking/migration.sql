-- AlterTable
ALTER TABLE "workout_schedules" ADD COLUMN     "unfinished_reminder_sent_at" TIMESTAMP(3),
ADD COLUMN     "upcoming_reminder_sent_at" TIMESTAMP(3);
