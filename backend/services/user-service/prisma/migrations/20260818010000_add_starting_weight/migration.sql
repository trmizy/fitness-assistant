-- Migration: add startingWeight / startingWeightSource to user_profiles
--
-- Root-cause fix (real-time body profile refactor): UserProfile.currentWeight is a mutable
-- cache overwritten on every InBody sync (see profileRepository.upsert /
-- inbody.service.ts:syncLatestInBodyToProfile) and there was previously no field anywhere in
-- the system representing the user's immutable "journey start" weight. See
-- docs/body-state-and-adaptive-planning.md.
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "startingWeight" DOUBLE PRECISION;
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "startingWeightSource" TEXT;

-- Data-only backfill for pre-existing profiles. Additive and non-destructive: never overwrites
-- a value that's already set, and never fabricates a number for a user with no weight data at
-- all (those are correctly left NULL — "unknown" rather than invented).
--
-- Prefers the EARLIEST InBodyEntry on record (a real historical measurement) over
-- currentWeight, since currentWeight has already been overwritten by every InBody sync since
-- and is not a reliable proxy for "where this user started". Falls back to currentWeight only
-- when the user has no InBody history at all. Either way this is a best-effort reconstruction
-- for users who existed before this column did, not a guaranteed-accurate original value —
-- hence startingWeightSource = 'LEGACY_BACKFILL' rather than 'ONBOARDING'/'INBODY' (those are
-- reserved for profiles that get startingWeight set going forward, by application code, at the
-- moment it's actually true).
UPDATE "user_profiles" up
SET
  "startingWeight" = COALESCE(
    (
      SELECT ie."weight"
      FROM "inbody_entries" ie
      WHERE ie."user_id" = up."userId"
      ORDER BY ie."date_only" ASC, ie."date" ASC
      LIMIT 1
    ),
    up."currentWeight"
  ),
  "startingWeightSource" = 'LEGACY_BACKFILL'
WHERE up."startingWeight" IS NULL
  AND (
    up."currentWeight" IS NOT NULL
    OR EXISTS (SELECT 1 FROM "inbody_entries" ie WHERE ie."user_id" = up."userId")
  );
