-- Phase 2 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md: extend the
-- existing CycleSessionFeedback table (additive only) + new
-- ExerciseSessionFeedback child table. No destructive changes; existing
-- rows/columns/reads are unaffected.

-- cycleId becomes optional — a session can exist (and get feedback)
-- outside any training cycle.
ALTER TABLE "cycle_session_feedback" ALTER COLUMN "cycle_id" DROP NOT NULL;

ALTER TABLE "cycle_session_feedback"
  ADD COLUMN "session_rating" INTEGER,
  ADD COLUMN "difficulty" TEXT,
  ADD COLUMN "enjoyment" TEXT,
  ADD COLUMN "fatigue_after_session" INTEGER,
  ADD COLUMN "pain_location" TEXT,
  ADD COLUMN "would_repeat_session" TEXT,
  ADD COLUMN "perceived_progress" TEXT,
  ADD COLUMN "feedback_missing" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "skip_reason" TEXT,
  ADD COLUMN "should_adjust_plan" BOOLEAN,
  ADD COLUMN "user_available_makeup_day" TIMESTAMP(3);

CREATE TABLE "exercise_session_feedback" (
  "id" TEXT NOT NULL,
  "session_feedback_id" TEXT NOT NULL,
  "exercise_id" TEXT NOT NULL,
  "rating" INTEGER,
  "issueType" TEXT,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "exercise_session_feedback_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "exercise_session_feedback"
  ADD CONSTRAINT "exercise_session_feedback_session_feedback_id_fkey"
  FOREIGN KEY ("session_feedback_id") REFERENCES "cycle_session_feedback"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "exercise_session_feedback_session_feedback_id_idx" ON "exercise_session_feedback"("session_feedback_id");
CREATE INDEX "exercise_session_feedback_exercise_id_idx" ON "exercise_session_feedback"("exercise_id");
