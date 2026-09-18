-- AI Nutrition Cycle Engine (Gymini) — Smart Substitute region
-- personalization (Bắc/Trung/Nam). Nullable: absence means "not set",
-- treated as "national" (no region reordering) by every reader — no
-- backfill needed, fully backward compatible with every existing profile.
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "region" TEXT;
