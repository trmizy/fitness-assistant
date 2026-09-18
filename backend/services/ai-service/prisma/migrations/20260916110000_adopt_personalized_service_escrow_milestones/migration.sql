-- Reconciliation migration — adopts 4 EXISTING, populated local columns
-- into repo migration history rather than creating them fresh.
--
-- Root cause (audited, not guessed — see
-- docs/aws-full-local-data-migration-schema-reconciliation.md §5): the
-- local `gymcoach_ai` database's `personalized_service_orders` table
-- already has four nullable timestamp columns
-- (milestone_intake_released_at, milestone_draft_released_at,
-- milestone_accepted_released_at, milestone_completed_released_at) that
-- were added by a migration named
-- `20260823120000_personalized_service_escrow_milestones`, recorded as
-- successfully finished in this database's own `_prisma_migrations`
-- table, whose folder no longer exists anywhere in this repository. As
-- with the user-service reconciliation migration, this does NOT
-- reconstruct that historical identity — it is a new, forward migration
-- adopting the columns' current real shape, audited directly via
-- `\d personalized_service_orders` (all four: nullable
-- `timestamp(3) without time zone`, no default, no index, no
-- constraint referencing them).
--
-- These four columns currently hold real, non-trivial data locally (409 /
-- 146 / 48 / 457 non-null rows respectively across draft / accepted /
-- completed / intake at audit time) — this migration only ADDS the
-- columns; it never drops, renames, or rewrites any value in them.
--
-- Zero application code anywhere in this repository reads or writes these
-- four columns (grep-verified — no reference in ai-service, no raw SQL
-- referencing them either), so this migration changes no runtime
-- behavior; see the reconciliation report §5 for the "was business code
-- using raw SQL for this" check the task asked for (answer: no).
--
-- IF NOT EXISTS on each column makes this migration safe in both required
-- situations:
--   A. local dev DB — the columns already exist with real data -> each
--      ADD COLUMN IF NOT EXISTS is a no-op; existing values are
--      completely untouched (no rewrite, no backfill).
--   B. a fresh DB built from this repo's migration history alone (e.g.
--      AWS Aurora) — the columns do not exist -> they are added here,
--      nullable, matching the live local shape exactly (no default is
--      invented; every restored/adopted row will source its real value
--      from the data-only restore, not from a fabricated default).
ALTER TABLE "personalized_service_orders"
  ADD COLUMN IF NOT EXISTS "milestone_intake_released_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "milestone_draft_released_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "milestone_accepted_released_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "milestone_completed_released_at" TIMESTAMP(3);
