-- Roadmap P1.3 "Superset / exercise grouping"
-- (docs/features/SUPERSET_GROUPING_IMPACT_ANALYSIS.md). Purely a
-- program-day planning concept — no changes to workout_exercises or
-- workout_sets, no risk to already-logged history.
CREATE TABLE "workout_program_exercise_groups" (
    "id" TEXT NOT NULL,
    "program_day_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "rest_between_exercises_seconds" INTEGER,
    "rest_after_round_seconds" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workout_program_exercise_groups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workout_program_exercise_group_members" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "program_exercise_id" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "workout_program_exercise_group_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workout_program_exercise_group_members_program_exercise_id_key"
    ON "workout_program_exercise_group_members"("program_exercise_id");

CREATE INDEX "workout_program_exercise_groups_program_day_id_idx"
    ON "workout_program_exercise_groups"("program_day_id");

CREATE INDEX "workout_program_exercise_group_members_group_id_idx"
    ON "workout_program_exercise_group_members"("group_id");

ALTER TABLE "workout_program_exercise_groups"
    ADD CONSTRAINT "workout_program_exercise_groups_program_day_id_fkey"
    FOREIGN KEY ("program_day_id") REFERENCES "workout_program_days"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workout_program_exercise_group_members"
    ADD CONSTRAINT "workout_program_exercise_group_members_group_id_fkey"
    FOREIGN KEY ("group_id") REFERENCES "workout_program_exercise_groups"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workout_program_exercise_group_members"
    ADD CONSTRAINT "workout_program_exercise_group_members_program_exercise_id_fkey"
    FOREIGN KEY ("program_exercise_id") REFERENCES "workout_program_exercises"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
