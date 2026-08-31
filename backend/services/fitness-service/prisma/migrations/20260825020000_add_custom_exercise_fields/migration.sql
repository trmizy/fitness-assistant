-- Roadmap P1.5 "Custom exercises"
-- (docs/features/CUSTOM_EXERCISES_IMPACT_ANALYSIS.md). Additive; every
-- pre-existing row is SYSTEM/no owner/not archived.
ALTER TABLE "exercises"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'SYSTEM',
  ADD COLUMN "owner_id" TEXT,
  ADD COLUMN "archived_at" TIMESTAMP(3);

CREATE INDEX "exercises_owner_id_idx" ON "exercises"("owner_id");
