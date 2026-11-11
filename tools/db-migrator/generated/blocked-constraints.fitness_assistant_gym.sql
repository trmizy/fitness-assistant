-- [fitness_assistant_gym] blocked / manual statements — NOT safe to execute as-is
-- [fitness_assistant_gym] MANUAL: 0 NULL rows out of 8 — SET NOT NULL would succeed today, but still MANUAL by design (narrows a column, not additive)
-- ALTER TABLE "gym_membership_plans" ALTER COLUMN "brand_id" SET NOT NULL;

