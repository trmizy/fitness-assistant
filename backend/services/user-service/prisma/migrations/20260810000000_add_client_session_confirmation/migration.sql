-- Client confirmation of PT-reported sessions (VĐ2).
-- The PT reporting a session no longer consumes the client's quota on its own; the session
-- parks in PENDING_CLIENT_CONFIRMATION until the client confirms, disputes, or the
-- auto-confirm sweep settles it.

-- AlterEnum: new lifecycle states.
-- Safe inside Prisma's transaction on PostgreSQL 12+ because the new labels are only
-- declared here, never written to rows in this same migration.
ALTER TYPE "SessionStatus" ADD VALUE IF NOT EXISTS 'PENDING_CLIENT_CONFIRMATION';
ALTER TYPE "SessionStatus" ADD VALUE IF NOT EXISTS 'DISPUTED';

-- AlterTable
ALTER TABLE "sessions"
  ADD COLUMN "client_confirm_deadline" TIMESTAMP(3),
  ADD COLUMN "auto_confirmed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "dispute_reason" TEXT,
  ADD COLUMN "disputed_at" TIMESTAMP(3),
  ADD COLUMN "resolved_by" TEXT,
  ADD COLUMN "resolution_note" TEXT,
  ADD COLUMN "resolved_at" TIMESTAMP(3);

-- CreateIndex: drives the auto-confirm sweep's (status, deadline) lookup.
CREATE INDEX "sessions_status_client_confirm_deadline_idx"
  ON "sessions"("status", "client_confirm_deadline");
