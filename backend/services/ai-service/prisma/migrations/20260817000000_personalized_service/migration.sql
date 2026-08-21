-- Marketplace rework: Personalized PT Service — new product type distinct
-- from TrainingPackage (which sells a fixed plan). Purely additive: no
-- existing table/column touched.

-- CreateEnum
CREATE TYPE "PersonalizedServiceType" AS ENUM ('PERSONALIZED_WORKOUT', 'PERSONALIZED_NUTRITION', 'WORKOUT_AND_NUTRITION', 'ONLINE_COACHING');

-- CreateEnum
CREATE TYPE "PersonalizedServiceStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PersonalizedServiceOrderStatus" AS ENUM ('PURCHASED', 'INTAKE_PENDING', 'INTAKE_SUBMITTED', 'PT_REVIEWING', 'IN_PROGRESS', 'DRAFT_DELIVERED', 'REVISION_REQUESTED', 'REVISION_IN_PROGRESS', 'ACCEPTED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'REFUND_REQUESTED', 'REFUNDED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "RevisionRequestCategory" AS ENUM ('EXERCISE', 'SCHEDULE', 'DIFFICULTY', 'EQUIPMENT', 'NUTRITION', 'OTHER');

-- CreateTable
CREATE TABLE "personalized_services" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "service_type" "PersonalizedServiceType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "deliverables" JSONB NOT NULL,
    "revision_limit" INTEGER,
    "initial_delivery_days" INTEGER NOT NULL,
    "support_weeks" INTEGER,
    "target_goal" TEXT,
    "target_level" TEXT,
    "status" "PersonalizedServiceStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personalized_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personalized_service_orders" (
    "id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "status" "PersonalizedServiceOrderStatus" NOT NULL DEFAULT 'PURCHASED',
    "title_snapshot" TEXT NOT NULL,
    "description_snapshot" TEXT,
    "service_type_snapshot" "PersonalizedServiceType" NOT NULL,
    "deliverables_snapshot" JSONB NOT NULL,
    "revision_limit_snapshot" INTEGER,
    "initial_delivery_days_snapshot" INTEGER NOT NULL,
    "support_weeks_snapshot" INTEGER,
    "price_at_purchase" DOUBLE PRECISION NOT NULL,
    "payment_transaction_id" TEXT,
    "purchased_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "intake_data" JSONB,
    "consent_categories" JSONB,
    "intake_submitted_at" TIMESTAMP(3),
    "contract_id" TEXT,
    "initial_delivery_deadline" TIMESTAMP(3),
    "draft_content" JSONB,
    "draft_version" INTEGER NOT NULL DEFAULT 0,
    "revision_count" INTEGER NOT NULL DEFAULT 0,
    "accepted_at" TIMESTAMP(3),
    "committed_program_id" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "refund_requested_at" TIMESTAMP(3),
    "refunded_at" TIMESTAMP(3),
    "dispute_reason" TEXT,
    "disputed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personalized_service_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personalized_service_revision_requests" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "category" "RevisionRequestCategory" NOT NULL,
    "comment" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "personalized_service_revision_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "personalized_services_seller_id_idx" ON "personalized_services"("seller_id");

-- CreateIndex
CREATE INDEX "personalized_services_status_idx" ON "personalized_services"("status");

-- CreateIndex
CREATE INDEX "personalized_service_orders_buyer_id_idx" ON "personalized_service_orders"("buyer_id");

-- CreateIndex
CREATE INDEX "personalized_service_orders_seller_id_idx" ON "personalized_service_orders"("seller_id");

-- CreateIndex
CREATE INDEX "personalized_service_orders_service_id_idx" ON "personalized_service_orders"("service_id");

-- CreateIndex
CREATE INDEX "personalized_service_orders_status_idx" ON "personalized_service_orders"("status");

-- CreateIndex
CREATE INDEX "personalized_service_revision_requests_order_id_idx" ON "personalized_service_revision_requests"("order_id");

-- AddForeignKey
ALTER TABLE "personalized_service_orders" ADD CONSTRAINT "personalized_service_orders_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "personalized_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personalized_service_revision_requests" ADD CONSTRAINT "personalized_service_revision_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "personalized_service_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
