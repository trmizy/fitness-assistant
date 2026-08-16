-- Onboarding wizard support: a free-text preferred-split field and a
-- completion flag distinct from "has any profile fields set". Additive,
-- defaults preserve existing rows unchanged (preferredSplit null,
-- hasCompletedOnboarding false for everyone until they finish the wizard).
ALTER TABLE "user_profiles" ADD COLUMN "preferred_split" TEXT;
ALTER TABLE "user_profiles" ADD COLUMN "has_completed_onboarding" BOOLEAN NOT NULL DEFAULT false;
