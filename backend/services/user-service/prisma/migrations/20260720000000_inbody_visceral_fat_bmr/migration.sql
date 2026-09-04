-- Adds visceral fat + BMR, both printed on a standard InBody scan but not
-- previously captured — needed to recompute TDEE for the training-cycle
-- decision's mealPlanDraft (see fitness-service's TrainingCycle v2).
--
-- Written defensively because 20260321032103 already creates inbody_entries with a `bmr`
-- column of type DOUBLE PRECISION. A plain ADD COLUMN therefore succeeded on the dev database
-- (where the column had been reshaped by `db push`) but failed on any clean replay with
-- "column bmr already exists" — which is part of why this history could not be replayed at
-- all. These statements reach the state schema.prisma declares from either starting point.
ALTER TABLE "inbody_entries" ADD COLUMN IF NOT EXISTS "visceral_fat" DOUBLE PRECISION;
ALTER TABLE "inbody_entries" ADD COLUMN IF NOT EXISTS "bmr" INTEGER;

-- schema.prisma declares `bmr Int?`; the earlier CREATE TABLE made it DOUBLE PRECISION.
-- Rounding is the right cast: a BMR is a kcal/day figure read off a printout, never fractional.
ALTER TABLE "inbody_entries"
  ALTER COLUMN "bmr" TYPE INTEGER USING ROUND("bmr")::INTEGER;
