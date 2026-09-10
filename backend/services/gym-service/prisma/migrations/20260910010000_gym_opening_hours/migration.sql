-- GYM_BRANCH_FORM_SPEC.md, Phase 2 — Step 3 "Opening Hours" + Step 2's optional location
-- instructions. Single-interval hours only (no split hours — backend never supported that,
-- §20 says not to fake it).

-- CreateEnum
CREATE TYPE "WeekDay" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateEnum
CREATE TYPE "DayScheduleType" AS ENUM ('OPEN', 'CLOSED', 'ALL_DAY');

-- AlterTable
ALTER TABLE "gyms" ADD COLUMN     "location_note" TEXT;

-- CreateTable
CREATE TABLE "gym_operating_hours" (
    "id" TEXT NOT NULL,
    "gym_id" TEXT NOT NULL,
    "day" "WeekDay" NOT NULL,
    "type" "DayScheduleType" NOT NULL DEFAULT 'CLOSED',
    "open_minute" INTEGER,
    "close_minute" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gym_operating_hours_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gym_operating_hours_gym_id_day_key" ON "gym_operating_hours"("gym_id", "day");

-- AddForeignKey
ALTER TABLE "gym_operating_hours" ADD CONSTRAINT "gym_operating_hours_gym_id_fkey" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
