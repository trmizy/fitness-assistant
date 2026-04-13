-- Migration: add plan generation lifecycle fields to workout_plans
-- Run automatically by `prisma migrate deploy` in production.
-- In dev, `prisma db push` handles this via schema drift.

CREATE TYPE "PlanStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

ALTER TABLE "workout_plans"
  ADD COLUMN "status"      "PlanStatus" NOT NULL DEFAULT 'QUEUED',
  ADD COLUMN "version"     INTEGER      NOT NULL DEFAULT 1,
  ADD COLUMN "job_id"      TEXT,
  ADD COLUMN "fail_reason" TEXT;

CREATE INDEX "workout_plans_job_id_idx"         ON "workout_plans" ("job_id");
CREATE INDEX "workout_plans_user_id_status_idx" ON "workout_plans" ("user_id", "status");
