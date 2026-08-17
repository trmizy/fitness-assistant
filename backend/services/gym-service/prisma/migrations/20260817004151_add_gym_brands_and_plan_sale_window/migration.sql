-- AlterTable
ALTER TABLE "gym_membership_plans" ADD COLUMN     "sale_end_at" TIMESTAMP(3),
ADD COLUMN     "sale_start_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "gyms" ADD COLUMN     "brand_id" TEXT;

-- CreateTable
CREATE TABLE "gym_brands" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gym_brands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gym_brands_owner_id_idx" ON "gym_brands"("owner_id");

-- CreateIndex
CREATE INDEX "gyms_brand_id_idx" ON "gyms"("brand_id");

-- AddForeignKey
ALTER TABLE "gyms" ADD CONSTRAINT "gyms_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "gym_brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;
