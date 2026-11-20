-- At most ONE in-flight in-place revision per AI workout plan, enforced by the database (atomic admission).
-- A revision operation targets the EXISTING plan id (target_type = 'WORKOUT_PLAN_REVISION'). The operation row only counts while it is in flight
-- (ADMITTED / PUBLISHED / RUNNING); COMPLETED / FAILED rows leave the index, so history and retries are unaffected. RESERVING rows have no target yet.
-- Additive and backward compatible: no column changes; old code never sets this target_type, so it is never constrained by it.
-- Prisma cannot express a partial unique index in schema.prisma; `prisma migrate diff` does not report it either (checked), so it is not dropped by a later migrate dev.
CREATE UNIQUE INDEX "ai_generation_operations_one_active_revision_per_plan"
  ON "ai_generation_operations" ("target_id")
  WHERE "target_type" = 'WORKOUT_PLAN_REVISION' AND "status" IN ('ADMITTED', 'PUBLISHED', 'RUNNING');
