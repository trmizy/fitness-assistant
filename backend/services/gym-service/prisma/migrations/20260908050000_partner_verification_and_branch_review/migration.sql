-- GYM_MANAGEMENT master spec, Phase 1 (Identity & Verification Foundation):
--   1. `verificationStatus` as its own axis on GymPartner, separate from lifecycle `status`.
--   2. `assignedAdminId` — "whose queue item is this" on GymPartner.
--   3. Structured per-field "Request Changes" notes on Gym (name/address only — the only two
--      moderated fields), instead of a single approve/reject.
--   4. `expectedReopenAt` on Gym — owner-entered reopen date for TEMPORARILY_CLOSED.
--   5. PartnerInternalNote — admin-only, owner-invisible notes.
--
-- Also closes a pre-existing schema/DB drift: migration 20260908040000 hand-created
-- `gyms_province_code_idx` directly in SQL but schema.prisma never declared the matching
-- @@index, so `prisma migrate diff` treated it as orphaned. Added `@@index([provinceCode])`
-- to schema.prisma; no DDL needed here since the index already exists in the database.

-- CreateEnum
CREATE TYPE "PartnerVerificationStatus" AS ENUM ('NOT_VERIFIED', 'IN_REVIEW', 'NEEDS_INFO', 'VERIFIED', 'REJECTED');

-- AlterTable
ALTER TABLE "gym_partners" ADD COLUMN     "assigned_admin_id" TEXT,
ADD COLUMN     "verification_notes" TEXT,
ADD COLUMN     "verification_status" "PartnerVerificationStatus" NOT NULL DEFAULT 'NOT_VERIFIED',
ADD COLUMN     "verified_at" TIMESTAMP(3),
ADD COLUMN     "verified_by" TEXT;

-- AlterTable
ALTER TABLE "gyms" ADD COLUMN     "changes_requested_at" TIMESTAMP(3),
ADD COLUMN     "changes_requested_by" TEXT,
ADD COLUMN     "expected_reopen_at" TIMESTAMP(3),
ADD COLUMN     "pending_address_note" TEXT,
ADD COLUMN     "pending_name_note" TEXT;

-- CreateTable
CREATE TABLE "partner_internal_notes" (
    "id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "author_admin_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_internal_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "partner_internal_notes_partner_id_created_at_idx" ON "partner_internal_notes"("partner_id", "created_at");

-- CreateIndex
CREATE INDEX "gym_partners_verification_status_idx" ON "gym_partners"("verification_status");

-- CreateIndex
CREATE INDEX "gym_partners_assigned_admin_id_idx" ON "gym_partners"("assigned_admin_id");

-- AddForeignKey
ALTER TABLE "partner_internal_notes" ADD CONSTRAINT "partner_internal_notes_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "gym_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: any partner that already made it PAST the prospect stage (INVITED, ACTIVE,
-- SUSPENDED, or TERMINATED) was already vetted under the pre-Phase-1 process — retroactively
-- marking them NOT_VERIFIED would lock a real, currently-active gym owner's account out of
-- future admin actions that will come to require VERIFIED (mirrors the exact onboarding-gate
-- lockout bug already hit once this session — same root cause, "recompute a new completeness
-- flag against old data", now avoided up front instead of fixed after the fact).
UPDATE "gym_partners"
SET "verification_status" = 'VERIFIED', "verified_at" = "created_at"
WHERE "status" != 'PROSPECT';

-- Backfill: a PROSPECT already carrying the old-style rejectedAt/rejectionReason (Phase 4 of
-- the earlier "quan-ly-doi-tac" rollout) is a partner an admin has already looked at and
-- turned down — reflect that on the new axis too so both mechanisms agree from day one.
UPDATE "gym_partners"
SET "verification_status" = 'REJECTED', "verification_notes" = "rejection_reason", "verified_at" = "rejected_at"
WHERE "status" = 'PROSPECT' AND "rejected_at" IS NOT NULL;
