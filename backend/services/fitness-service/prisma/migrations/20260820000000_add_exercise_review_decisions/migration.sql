-- Gate 7 of the exercise/anatomy/nutrition data-expansion roadmap.
-- ADDITIVE ONLY — one brand-new table, no existing table touched, no
-- existing column changed. FK to "exercises" uses ON DELETE SET NULL (a
-- review decision's audit record must survive even if the exercise it
-- was linked to is ever deleted — the decision history is the durable
-- artifact, not a hard dependency on the current state of that row).

CREATE TABLE IF NOT EXISTS "exercise_review_decisions" (
  "id" TEXT NOT NULL,
  "external_ref" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'curated_vi_exercise_catalog',
  "decision" TEXT NOT NULL,
  "target_exercise_id" TEXT,
  "created_exercise_id" TEXT,
  "note" TEXT,
  "duplicate_decision_at_review" TEXT,
  "candidate_snapshot" JSONB,
  "reviewer_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "exercise_review_decisions_pkey" PRIMARY KEY ("id")
);

-- Append-only table (see the Prisma model's doc comment) — a plain index
-- for "most recent decision for this candidate" lookups, not a unique
-- constraint; multiple rows per (external_ref, source) are expected as a
-- reviewer's decision evolves over time.
CREATE INDEX IF NOT EXISTS "exercise_review_decisions_external_ref_source_created_at_idx"
  ON "exercise_review_decisions"("external_ref", "source", "created_at");
CREATE INDEX IF NOT EXISTS "exercise_review_decisions_decision_idx"
  ON "exercise_review_decisions"("decision");

DO $$ BEGIN
  ALTER TABLE "exercise_review_decisions" ADD CONSTRAINT "exercise_review_decisions_target_exercise_id_fkey"
    FOREIGN KEY ("target_exercise_id") REFERENCES "exercises"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
