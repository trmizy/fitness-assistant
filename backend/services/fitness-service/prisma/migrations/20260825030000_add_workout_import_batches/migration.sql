-- Roadmap P2 "Canonical import framework" + P2.1 "Hevy import"
-- (docs/features/CANONICAL_IMPORT_FRAMEWORK_IMPACT_ANALYSIS.md)
CREATE TABLE "workout_import_batches" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREVIEW',
    "parsed_workouts_json" JSONB NOT NULL,
    "match_summary_json" JSONB NOT NULL,
    "created_workout_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "committed_source_hashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committed_at" TIMESTAMP(3),

    CONSTRAINT "workout_import_batches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "workout_import_batches_user_id_status_idx" ON "workout_import_batches"("user_id", "status");
