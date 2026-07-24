-- AlterTable
ALTER TABLE "workout_schedules" ADD COLUMN     "training_cycle_id" TEXT;

-- AlterTable
ALTER TABLE "training_cycles" ADD COLUMN     "actual_end_date" TIMESTAMP(3),
ADD COLUMN     "baseline_metrics" JSONB,
ADD COLUMN     "configuration" JSONB,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "target_metrics" JSONB;

-- CreateTable
CREATE TABLE "cycle_assessments" (
    "id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "assessment_version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decision" TEXT,
    "confidence_score" DOUBLE PRECISION,
    "data_quality_score" DOUBLE PRECISION,
    "computed_metrics" JSONB,
    "reason_codes" JSONB,
    "conflicting_signals" JSONB,
    "safety_flags" JSONB,
    "recommended_action_scope" JSONB,
    "ai_summary" TEXT,
    "proposed_changes" JSONB,
    "user_decision" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cycle_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cycle_session_feedback" (
    "id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "workout_schedule_id" TEXT NOT NULL,
    "readiness_score" INTEGER,
    "session_rpe" DOUBLE PRECISION,
    "pain_score" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cycle_session_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cycle_inbody_links" (
    "id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "inbody_entry_id" TEXT NOT NULL,
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cycle_inbody_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cycle_assessments_cycle_id_created_at_idx" ON "cycle_assessments"("cycle_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "cycle_assessments_cycle_id_assessment_version_key" ON "cycle_assessments"("cycle_id", "assessment_version");

-- CreateIndex
CREATE UNIQUE INDEX "cycle_session_feedback_workout_schedule_id_key" ON "cycle_session_feedback"("workout_schedule_id");

-- CreateIndex
CREATE INDEX "cycle_session_feedback_cycle_id_idx" ON "cycle_session_feedback"("cycle_id");

-- CreateIndex
CREATE INDEX "cycle_inbody_links_cycle_id_idx" ON "cycle_inbody_links"("cycle_id");

-- CreateIndex
CREATE UNIQUE INDEX "cycle_inbody_links_cycle_id_inbody_entry_id_key" ON "cycle_inbody_links"("cycle_id", "inbody_entry_id");

-- CreateIndex
CREATE INDEX "workout_schedules_training_cycle_id_idx" ON "workout_schedules"("training_cycle_id");

-- AddForeignKey
ALTER TABLE "workout_schedules" ADD CONSTRAINT "workout_schedules_training_cycle_id_fkey" FOREIGN KEY ("training_cycle_id") REFERENCES "training_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_assessments" ADD CONSTRAINT "cycle_assessments_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "training_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_session_feedback" ADD CONSTRAINT "cycle_session_feedback_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "training_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_session_feedback" ADD CONSTRAINT "cycle_session_feedback_workout_schedule_id_fkey" FOREIGN KEY ("workout_schedule_id") REFERENCES "workout_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_inbody_links" ADD CONSTRAINT "cycle_inbody_links_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "training_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

