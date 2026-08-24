-- Roadmap P1.2 "Reschedule workout" (docs/features/RESCHEDULE_WORKOUT_IMPACT_ANALYSIS.md)
-- Pure audit-trail columns — the reschedule mutation itself is a plain
-- UPDATE of the existing row's `date` (see the impact analysis's "Audit
-- findings" for why no new row/logicalScheduleId is needed). All nullable,
-- null = never rescheduled; no backfill required.
ALTER TABLE "workout_schedules"
  ADD COLUMN "original_planned_date" TIMESTAMP(3),
  ADD COLUMN "rescheduled_at" TIMESTAMP(3),
  ADD COLUMN "reschedule_reason" TEXT;
