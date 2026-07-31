-- CreateEnum
CREATE TYPE "TrainingPackageStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TrainingPackagePurchaseStatus" AS ENUM ('PENDING', 'PAID', 'FAILED');

-- CreateTable
CREATE TABLE "training_packages" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "published_plan_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "duration_weeks" INTEGER,
    "status" "TrainingPackageStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_package_purchases" (
    "id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "price_at_purchase" DOUBLE PRECISION NOT NULL,
    "payment_transaction_id" TEXT,
    "status" "TrainingPackagePurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "purchased_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_package_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "training_packages_seller_id_idx" ON "training_packages"("seller_id");

-- CreateIndex
CREATE INDEX "training_packages_status_idx" ON "training_packages"("status");

-- CreateIndex
CREATE INDEX "training_packages_published_plan_id_idx" ON "training_packages"("published_plan_id");

-- CreateIndex
CREATE INDEX "training_package_purchases_buyer_id_idx" ON "training_package_purchases"("buyer_id");

-- CreateIndex
CREATE INDEX "training_package_purchases_package_id_idx" ON "training_package_purchases"("package_id");

-- CreateIndex
CREATE UNIQUE INDEX "training_package_purchases_package_id_buyer_id_key" ON "training_package_purchases"("package_id", "buyer_id");

-- AddForeignKey
ALTER TABLE "training_packages" ADD CONSTRAINT "training_packages_published_plan_id_fkey" FOREIGN KEY ("published_plan_id") REFERENCES "published_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_package_purchases" ADD CONSTRAINT "training_package_purchases_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "training_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
