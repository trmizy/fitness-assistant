-- Money-flow redesign plan 2.6: retry tracking for the auth-service -> user-service relay
-- that unwinds a PT's live contracts when their account is locked/unlocked.
CREATE TYPE "PtDeactivationAction" AS ENUM ('DEACTIVATE', 'REACTIVATE');
CREATE TYPE "PtDeactivationCallStatus" AS ENUM ('PENDING', 'SETTLED', 'FAILED');

CREATE TABLE "pt_deactivation_calls" (
    "id" TEXT NOT NULL,
    "pt_user_id" TEXT NOT NULL,
    "action" "PtDeactivationAction" NOT NULL,
    "admin_id" TEXT NOT NULL,
    "reason" TEXT,
    "status" "PtDeactivationCallStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pt_deactivation_calls_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pt_deactivation_calls_status_idx" ON "pt_deactivation_calls"("status");
