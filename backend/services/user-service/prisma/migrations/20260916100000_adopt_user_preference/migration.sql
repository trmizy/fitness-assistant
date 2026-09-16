-- Reconciliation migration — adopts an EXISTING local table into repo
-- migration history rather than creating it fresh.
--
-- Root cause (audited, not guessed — see
-- docs/aws-full-local-data-migration-schema-reconciliation.md §2): a
-- `UserPreference` table already exists in the local `gymcoach_user`
-- database (1 row today) and was applied there by a migration named
-- `20260905063000_account_preferences`, which is recorded as successfully
-- finished in this database's own `_prisma_migrations` table but whose
-- migration folder no longer exists anywhere in this repository. There is
-- no way to know or reproduce that folder's original exact SQL, and this
-- migration does not attempt to re-create that historical identity (the
-- task's own instruction: do not recreate old migration history under the
-- same identity) — this is a NEW, forward migration that adopts the
-- table's CURRENT real shape, audited directly from the live database via
-- `\d "UserPreference"`, not inferred from any documentation.
--
-- Zero application code anywhere in this repository references
-- `UserPreference` (grep-verified across user-service, ai-service,
-- frontend, and backend/shared) — this table is a pure schema orphan with
-- no business logic depending on it, so this migration changes no runtime
-- behavior.
--
-- IF NOT EXISTS makes this migration safe in both required situations:
--   A. local dev DB — the table already exists (created by the missing
--      historical migration) -> this is a no-op, the existing row and
--      table are left completely untouched.
--   B. a fresh DB built from this repo's migration history alone (e.g.
--      AWS Aurora) — the table does not exist -> it is created here,
--      exactly matching the live local shape.
--
-- Column/table names, types, nullability, defaults, the primary key, and
-- the check constraint below are all copied verbatim from the live local
-- table — nothing is renamed, and this repo's later `snake_case` +
-- `@map`/`@@map` convention (see other models in schema.prisma) is
-- deliberately NOT retrofitted onto this table, because doing so would
-- require actually renaming a real existing column/table, which the task
-- explicitly forbids.
CREATE TABLE IF NOT EXISTS "UserPreference" (
    "userId" TEXT NOT NULL,
    "showRpeRir" BOOLEAN NOT NULL DEFAULT true,
    "defaultRestSeconds" INTEGER NOT NULL DEFAULT 90,
    "keepScreenAwake" BOOLEAN NOT NULL DEFAULT true,
    "restTimerSound" BOOLEAN NOT NULL DEFAULT true,
    "restTimerVibration" BOOLEAN NOT NULL DEFAULT true,
    "smartPrefill" BOOLEAN NOT NULL DEFAULT true,
    "showMacros" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("userId")
);

-- The live table's own check constraint (confirmed via `\d`), added only
-- if this table was just created fresh by the statement above and
-- therefore cannot already have it. On the local DB (table pre-existing),
-- this table already carries this exact constraint, so it is skipped by
-- name to avoid a duplicate-constraint error rather than creating a
-- second one.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'UserPreference_rest_range'
  ) THEN
    ALTER TABLE "UserPreference"
      ADD CONSTRAINT "UserPreference_rest_range"
      CHECK ("defaultRestSeconds" >= 15 AND "defaultRestSeconds" <= 300 AND ("defaultRestSeconds" % 15) = 0);
  END IF;
END $$;
