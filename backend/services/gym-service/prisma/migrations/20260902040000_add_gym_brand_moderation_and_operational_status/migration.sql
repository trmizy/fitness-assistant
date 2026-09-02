-- Vòng 4 / Phase C — brand/gym name+address moderation overlay (C1/C2) and the gym's own
-- operational-status axis (C3), independent from the existing moderation `status` column.
--
-- Hand-written (not `prisma migrate dev` generated) so the backfill below can run in the same
-- migration as the column adds — every EXISTING row must land in a state consistent with its
-- current reality (an already-APPROVED gym must not suddenly show as "pending approval"
-- publicly just because these columns default to null).

-- ── C3: operational status axis ─────────────────────────────────────────────
CREATE TYPE "GymOperationalStatus" AS ENUM ('OPEN', 'TEMPORARILY_CLOSED', 'PERMANENTLY_CLOSED');

ALTER TABLE "gyms"
  ADD COLUMN "operational_status" "GymOperationalStatus" NOT NULL DEFAULT 'OPEN',
  ADD COLUMN "closure_reason" TEXT,
  ADD COLUMN "closed_at" TIMESTAMP(3),
  ADD COLUMN "reopened_at" TIMESTAMP(3);

CREATE INDEX "gyms_operational_status_idx" ON "gyms"("operational_status");

-- ── C1/C2: name+address moderation overlay ──────────────────────────────────
ALTER TABLE "gym_brands"
  ADD COLUMN "approved_name" TEXT,
  ADD COLUMN "pending_name" TEXT;

ALTER TABLE "gyms"
  ADD COLUMN "approved_name" TEXT,
  ADD COLUMN "pending_name" TEXT,
  ADD COLUMN "approved_address" TEXT,
  ADD COLUMN "pending_address" TEXT;

-- Backfill gyms: a gym already APPROVED today has its current name/address treated as already
-- publicly approved (nothing pending) — this is the "first approval" gymService.setStatus
-- would have performed had this column existed when it was actually approved. A gym that has
-- never been approved (PENDING_REVIEW/REJECTED/SUSPENDED-before-ever-approved) has its name
-- sitting in pendingName, awaiting that first approval, same as a brand-new row created after
-- this migration would.
UPDATE "gyms" SET "approved_name" = "name", "approved_address" = "address"
  WHERE "status" = 'APPROVED';
UPDATE "gyms" SET "pending_name" = "name", "pending_address" = "address"
  WHERE "status" != 'APPROVED';

-- Backfill gym_brands: a brand counts as already-approved if it has at least one APPROVED
-- branch today (that branch's own approval is what would have triggered the first-approval
-- backfill under the new code, had these columns existed then).
UPDATE "gym_brands" SET "approved_name" = "name"
  WHERE EXISTS (SELECT 1 FROM "gyms" WHERE "gyms"."brand_id" = "gym_brands"."id" AND "gyms"."status" = 'APPROVED');
UPDATE "gym_brands" SET "pending_name" = "name"
  WHERE NOT EXISTS (SELECT 1 FROM "gyms" WHERE "gyms"."brand_id" = "gym_brands"."id" AND "gyms"."status" = 'APPROVED');
