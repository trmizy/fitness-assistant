-- GYM_BRANCH_FORM_SPEC.md, Phase 4 — "Request Changes" by category on a branch's first-time
-- wizard submission (distinct from Gym.pendingNameNote/pendingAddressNote, which is for an
-- ALREADY-APPROVED branch's later rename — see this model's own schema doc comment).

-- CreateEnum
CREATE TYPE "BranchReviewCategory" AS ENUM ('BASIC_INFO', 'LOCATION', 'OPENING_HOURS', 'FACILITIES', 'PHOTOS', 'VERIFICATION', 'OTHER');

-- CreateTable
CREATE TABLE "gym_branch_review_issues" (
    "id" TEXT NOT NULL,
    "gym_id" TEXT NOT NULL,
    "category" "BranchReviewCategory" NOT NULL,
    "message" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gym_branch_review_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gym_branch_review_issues_gym_id_resolved_at_idx" ON "gym_branch_review_issues"("gym_id", "resolved_at");

-- AddForeignKey
ALTER TABLE "gym_branch_review_issues" ADD CONSTRAINT "gym_branch_review_issues_gym_id_fkey" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
