-- Data-only backfill (Phase 13 production hardening).
--
-- The previous migration (20260803000000_user_profile_onboarding_fields)
-- added "has_completed_onboarding" with a hard default of false. That is
-- correct for brand-new signups going through the new onboarding wizard,
-- but it also silently defaulted EVERY pre-existing profile to false --
-- including ones that already have a real goal/experienceLevel/
-- preferredTrainingDays from before the wizard existed. Left unfixed, every
-- such user would be forcibly redirected to /client/onboarding on their
-- next login by RequireOnboarding.tsx, even though they already have a
-- complete profile and have been actively using the app.
--
-- Treat "already has the core onboarding fields populated" as equivalent
-- to "has completed onboarding". Profiles missing any of these three
-- fields are left as false and correctly go through the real wizard.
UPDATE "user_profiles"
SET "has_completed_onboarding" = true
WHERE "goal" IS NOT NULL
  AND "experienceLevel" IS NOT NULL
  AND "preferredTrainingDays" IS NOT NULL
  AND array_length("preferredTrainingDays", 1) > 0
  AND "has_completed_onboarding" = false;
