-- Long-horizon orchestration layer. Additive only: no existing
-- TrainingCycle/WorkoutProgram/NutritionGoal/NutritionProgram rows are
-- rewritten or guessed into a roadmap.

CREATE TYPE "FitnessRoadmapStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'ARCHIVED');
CREATE TYPE "RoadmapCreatorRole" AS ENUM ('CLIENT', 'PT', 'AI', 'SYSTEM');
CREATE TYPE "RoadmapPhaseType" AS ENUM ('FAT_LOSS', 'DIET_BREAK', 'MAINTENANCE', 'LEAN_GAIN', 'MINI_CUT', 'RECOMPOSITION', 'PERFORMANCE', 'RECOVERY');
CREATE TYPE "RoadmapPhaseStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'SKIPPED');

CREATE TABLE "fitness_roadmaps" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "goal_type" TEXT NOT NULL,
  "status" "FitnessRoadmapStatus" NOT NULL DEFAULT 'DRAFT',
  "planned_start_at" TIMESTAMP(3) NOT NULL,
  "planned_end_at" TIMESTAMP(3),
  "actual_start_at" TIMESTAMP(3),
  "actual_end_at" TIMESTAMP(3),
  "created_by_user_id" TEXT,
  "created_by_role" "RoadmapCreatorRole" NOT NULL DEFAULT 'CLIENT',
  "source_assessment_id" TEXT,
  "target_metrics" JSONB,
  "configuration" JSONB,
  "version" INTEGER NOT NULL DEFAULT 1,
  "previous_roadmap_id" TEXT,
  "idempotency_key" TEXT,
  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fitness_roadmaps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "roadmap_phases" (
  "id" TEXT NOT NULL,
  "roadmap_id" TEXT NOT NULL,
  "phase_index" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "phase_type" "RoadmapPhaseType" NOT NULL,
  "status" "RoadmapPhaseStatus" NOT NULL DEFAULT 'PLANNED',
  "planned_start_at" TIMESTAMP(3) NOT NULL,
  "planned_end_at" TIMESTAMP(3) NOT NULL,
  "actual_start_at" TIMESTAMP(3),
  "actual_end_at" TIMESTAMP(3),
  "objective" JSONB,
  "constraints" JSONB,
  "transition_rules" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "roadmap_phases_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "training_cycles"
  ADD COLUMN "roadmap_phase_id" TEXT,
  ADD COLUMN "sequence_in_phase" INTEGER;

CREATE UNIQUE INDEX "fitness_roadmaps_user_id_idempotency_key_key"
  ON "fitness_roadmaps" ("user_id", "idempotency_key");
CREATE INDEX "fitness_roadmaps_user_id_status_idx"
  ON "fitness_roadmaps" ("user_id", "status");
CREATE INDEX "fitness_roadmaps_user_id_planned_start_at_idx"
  ON "fitness_roadmaps" ("user_id", "planned_start_at");
CREATE UNIQUE INDEX "fitness_roadmaps_one_active_per_user"
  ON "fitness_roadmaps" ("user_id")
  WHERE status = 'ACTIVE' AND archived_at IS NULL;

CREATE UNIQUE INDEX "roadmap_phases_roadmap_id_phase_index_key"
  ON "roadmap_phases" ("roadmap_id", "phase_index");
CREATE INDEX "roadmap_phases_roadmap_id_status_idx"
  ON "roadmap_phases" ("roadmap_id", "status");
CREATE UNIQUE INDEX "roadmap_phases_one_active_per_roadmap"
  ON "roadmap_phases" ("roadmap_id")
  WHERE status = 'ACTIVE';

CREATE INDEX "training_cycles_roadmap_phase_id_idx"
  ON "training_cycles" ("roadmap_phase_id");
CREATE UNIQUE INDEX "training_cycles_roadmap_phase_id_sequence_in_phase_key"
  ON "training_cycles" ("roadmap_phase_id", "sequence_in_phase");
CREATE UNIQUE INDEX "training_cycles_one_active_per_phase"
  ON "training_cycles" ("roadmap_phase_id")
  WHERE roadmap_phase_id IS NOT NULL AND status = 'ACTIVE' AND archived_at IS NULL;

ALTER TABLE "roadmap_phases"
  ADD CONSTRAINT "roadmap_phases_roadmap_id_fkey"
  FOREIGN KEY ("roadmap_id") REFERENCES "fitness_roadmaps"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "training_cycles"
  ADD CONSTRAINT "training_cycles_roadmap_phase_id_fkey"
  FOREIGN KEY ("roadmap_phase_id") REFERENCES "roadmap_phases"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
