-- In-place AI workout plan revisions (additive; no existing row or column is touched).
CREATE TABLE "workout_plan_revisions" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "operation_id" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'ADJUST',
    "base_version" INTEGER NOT NULL,
    "result_version" INTEGER NOT NULL,
    "adjustments" TEXT,
    "previous" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workout_plan_revisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workout_plan_revisions_operation_id_key" ON "workout_plan_revisions"("operation_id");
CREATE UNIQUE INDEX "workout_plan_revisions_plan_id_result_version_key" ON "workout_plan_revisions"("plan_id", "result_version");
CREATE INDEX "workout_plan_revisions_plan_id_created_at_idx" ON "workout_plan_revisions"("plan_id", "created_at");
CREATE INDEX "workout_plan_revisions_user_id_idx" ON "workout_plan_revisions"("user_id");
