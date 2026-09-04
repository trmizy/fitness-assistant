-- Phase 3 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md: deterministic
-- cycle feedback rollup table. Purely additive new table.

CREATE TABLE "cycle_feedback_summaries" (
  "id" TEXT NOT NULL,
  "cycle_id" TEXT NOT NULL,

  "total_sessions" INTEGER NOT NULL,
  "completed_sessions" INTEGER NOT NULL,
  "partial_sessions" INTEGER NOT NULL,
  "skipped_sessions" INTEGER NOT NULL,
  "cancelled_sessions" INTEGER NOT NULL,
  "feedback_submitted_count" INTEGER NOT NULL,
  "feedback_missing_count" INTEGER NOT NULL,
  "feedback_completion_rate" DOUBLE PRECISION NOT NULL,

  "average_session_rating" DOUBLE PRECISION,
  "average_difficulty_score" DOUBLE PRECISION,
  "average_enjoyment_score" DOUBLE PRECISION,
  "average_fatigue" DOUBLE PRECISION,
  "average_pain" DOUBLE PRECISION,

  "most_common_issues" JSONB NOT NULL,
  "most_liked_exercises" JSONB NOT NULL,
  "most_disliked_exercises" JSONB NOT NULL,
  "exercises_with_pain_reports" JSONB NOT NULL,

  "sessions_marked_too_hard" INTEGER NOT NULL,
  "sessions_marked_too_easy" INTEGER NOT NULL,
  "sessions_user_would_not_repeat" INTEGER NOT NULL,

  "positive_feedback_count" INTEGER NOT NULL,
  "negative_feedback_count" INTEGER NOT NULL,
  "neutral_feedback_count" INTEGER NOT NULL,
  "mixed_feedback_count" INTEGER NOT NULL,
  "feedback_sentiment_by_rules" TEXT NOT NULL,

  "data_quality_score" DOUBLE PRECISION NOT NULL,

  "safety_flags" JSONB NOT NULL,
  "equipment_mismatch_flags" JSONB NOT NULL,
  "adherence_related_complaint_flags" JSONB NOT NULL,
  "motivation_or_boredom_flags" JSONB NOT NULL,

  "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "cycle_feedback_summaries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cycle_feedback_summaries_cycle_id_key" ON "cycle_feedback_summaries"("cycle_id");

ALTER TABLE "cycle_feedback_summaries"
  ADD CONSTRAINT "cycle_feedback_summaries_cycle_id_fkey"
  FOREIGN KEY ("cycle_id") REFERENCES "training_cycles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
