-- AlterTable
ALTER TABLE "user_profiles" ADD COLUMN     "energy_unit" TEXT NOT NULL DEFAULT 'kcal',
ADD COLUMN     "unit_system" TEXT NOT NULL DEFAULT 'metric';
