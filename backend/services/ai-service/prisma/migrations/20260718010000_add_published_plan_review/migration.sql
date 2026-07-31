-- CreateEnum
CREATE TYPE "PublishModerationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "published_plans" (
    "id" TEXT NOT NULL,
    "source_plan_id" TEXT NOT NULL,
    "publisher_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "goal" TEXT NOT NULL,
    "moderation_status" "PublishModerationStatus" NOT NULL DEFAULT 'DRAFT',
    "moderation_note" TEXT,
    "avg_rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "published_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_reviews" (
    "id" TEXT NOT NULL,
    "published_plan_id" TEXT NOT NULL,
    "reviewer_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "published_plans_publisher_id_idx" ON "published_plans"("publisher_id");

-- CreateIndex
CREATE INDEX "published_plans_moderation_status_idx" ON "published_plans"("moderation_status");

-- CreateIndex
CREATE INDEX "plan_reviews_published_plan_id_idx" ON "plan_reviews"("published_plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "plan_reviews_published_plan_id_reviewer_id_key" ON "plan_reviews"("published_plan_id", "reviewer_id");

-- AddForeignKey
ALTER TABLE "published_plans" ADD CONSTRAINT "published_plans_source_plan_id_fkey" FOREIGN KEY ("source_plan_id") REFERENCES "workout_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_reviews" ADD CONSTRAINT "plan_reviews_published_plan_id_fkey" FOREIGN KEY ("published_plan_id") REFERENCES "published_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
