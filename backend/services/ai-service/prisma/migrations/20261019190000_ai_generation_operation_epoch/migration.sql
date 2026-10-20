-- AlterTable
ALTER TABLE "ai_generation_operations" ADD COLUMN     "epoch" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "publish_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reservation_token" TEXT;

