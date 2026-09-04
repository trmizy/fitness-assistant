-- Additive fields bringing the production Exercise schema closer to the
-- richer curated catalog in data/catalog/plans/gym_exercises.csv (see
-- docs/TRAINING_KNOWLEDGE_BASE_PLAN.md §1). All nullable/defaulted —
-- existing rows are unaffected, never backfilled with guessed values.
ALTER TABLE "exercises"
  ADD COLUMN "movement_pattern" TEXT,
  ADD COLUMN "mechanics" TEXT,
  ADD COLUMN "contraindications" TEXT[] NOT NULL DEFAULT '{}';
