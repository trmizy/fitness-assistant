-- CreateEnum
CREATE TYPE "PtReviewStatus" AS ENUM ('PENDING_PT_REVIEW', 'PT_APPROVED', 'PT_REJECTED');

-- AlterTable
ALTER TABLE "workout_plans" ADD COLUMN     "client_name" TEXT,
ADD COLUMN     "pt_name" TEXT,
ADD COLUMN     "pt_note" TEXT,
ADD COLUMN     "pt_review_status" "PtReviewStatus",
ADD COLUMN     "pt_reviewed_at" TIMESTAMP(3),
ADD COLUMN     "pt_user_id" TEXT;

-- CreateIndex
CREATE INDEX "workout_plans_pt_user_id_pt_review_status_idx" ON "workout_plans"("pt_user_id", "pt_review_status");
