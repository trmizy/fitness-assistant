-- Money-flow redesign plan 1.6: retry tracking for financial operations, decoupled from
-- session/contract business status.
CREATE TYPE "SessionSettlementKind" AS ENUM ('PT_NO_SHOW_COMPENSATION', 'SESSION_RELEASE', 'CONTRACT_TERMINATION');
CREATE TYPE "SessionSettlementStatus" AS ENUM ('PENDING', 'PROCESSING', 'SETTLED', 'FAILED');

CREATE TABLE "session_settlements" (
    "id" TEXT NOT NULL,
    "kind" "SessionSettlementKind" NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "session_id" TEXT,
    "contract_id" TEXT NOT NULL,
    "reason" TEXT,
    "status" "SessionSettlementStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "settled_at" TIMESTAMP(3),

    CONSTRAINT "session_settlements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "session_settlements_idempotency_key_key" ON "session_settlements"("idempotency_key");
CREATE INDEX "session_settlements_status_idx" ON "session_settlements"("status");
