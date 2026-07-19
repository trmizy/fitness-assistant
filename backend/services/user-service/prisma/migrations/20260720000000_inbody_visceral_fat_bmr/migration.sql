-- Adds visceral fat + BMR, both printed on a standard InBody scan but not
-- previously captured — needed to recompute TDEE for the training-cycle
-- decision's mealPlanDraft (see fitness-service's TrainingCycle v2).
ALTER TABLE "inbody_entries" ADD COLUMN "visceral_fat" DOUBLE PRECISION;
ALTER TABLE "inbody_entries" ADD COLUMN "bmr" INTEGER;
