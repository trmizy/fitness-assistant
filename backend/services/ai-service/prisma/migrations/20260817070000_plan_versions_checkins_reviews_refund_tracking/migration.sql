-- AlterTable: refund resolution tracking on PersonalizedServiceOrder
ALTER TABLE "personalized_service_orders"
  ADD COLUMN "cumulative_refunded_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "refund_resolved_by" TEXT,
  ADD COLUMN "refund_resolved_at" TIMESTAMP(3),
  ADD COLUMN "refund_resolution_note" TEXT,
  ADD COLUMN "refund_decision" TEXT;

-- CreateEnum
CREATE TYPE "PlanVersionStatus" AS ENUM ('DELIVERED', 'ACCEPTED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "personalized_service_plan_versions" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "status" "PlanVersionStatus" NOT NULL DEFAULT 'DELIVERED',
    "created_by" TEXT NOT NULL,
    "change_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "personalized_service_plan_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "personalized_service_plan_versions_order_id_version_key" ON "personalized_service_plan_versions"("order_id", "version");
CREATE INDEX "personalized_service_plan_versions_order_id_idx" ON "personalized_service_plan_versions"("order_id");

ALTER TABLE "personalized_service_plan_versions"
  ADD CONSTRAINT "personalized_service_plan_versions_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "personalized_service_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "personalized_service_checkins" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "week_number" INTEGER,
    "weight" DOUBLE PRECISION,
    "energy_level" INTEGER,
    "sleep_quality" INTEGER,
    "stress_level" INTEGER,
    "overall_rpe" DOUBLE PRECISION,
    "workout_adherence" INTEGER,
    "nutrition_adherence" INTEGER,
    "pain_or_discomfort" INTEGER,
    "notes" TEXT,
    "requires_attention" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "personalized_service_checkins_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "personalized_service_checkins_order_id_created_at_idx" ON "personalized_service_checkins"("order_id", "created_at");

ALTER TABLE "personalized_service_checkins"
  ADD CONSTRAINT "personalized_service_checkins_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "personalized_service_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "personalized_service_reviews" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "overall_rating" INTEGER NOT NULL,
    "communication_rating" INTEGER,
    "personalization_rating" INTEGER,
    "plan_quality_rating" INTEGER,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "personalized_service_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "personalized_service_reviews_order_id_key" ON "personalized_service_reviews"("order_id");
CREATE INDEX "personalized_service_reviews_seller_id_idx" ON "personalized_service_reviews"("seller_id");

ALTER TABLE "personalized_service_reviews"
  ADD CONSTRAINT "personalized_service_reviews_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "personalized_service_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
