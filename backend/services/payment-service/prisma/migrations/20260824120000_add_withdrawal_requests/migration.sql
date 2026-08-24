-- Money-flow redesign plan 5.3: minimal manual withdrawal flow. The ledger debit only happens
-- when an admin confirms the manual transfer already happened (markPaid) — this table tracks
-- that, it does not trigger any payout API.
CREATE TYPE "WithdrawalRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'REJECTED');

CREATE TABLE "withdrawal_requests" (
    "id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "owner_type" "WalletOwnerType" NOT NULL,
    "owner_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "WithdrawalRequestStatus" NOT NULL DEFAULT 'PENDING',
    "payout_info" TEXT NOT NULL,
    "bank_reference" TEXT,
    "rejection_reason" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "withdrawal_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "withdrawal_requests_wallet_id_status_idx" ON "withdrawal_requests"("wallet_id", "status");
CREATE INDEX "withdrawal_requests_status_idx" ON "withdrawal_requests"("status");

ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
