-- Extend PurposeType with WALLET_TOPUP and REFUND (CREATE TYPE + RENAME —
-- same transaction-safe pattern used for the auth Role enum migration).
CREATE TYPE "PurposeType_new" AS ENUM ('GYM_MEMBERSHIP', 'PT_CONTRACT', 'GYM_PT_COMBO', 'WALLET_TOPUP', 'REFUND');
ALTER TABLE "payment_transactions" ALTER COLUMN "purpose" TYPE "PurposeType_new" USING ("purpose"::text::"PurposeType_new");
DROP TYPE "PurposeType";
ALTER TYPE "PurposeType_new" RENAME TO "PurposeType";

-- CreateEnum
CREATE TYPE "WalletOwnerType" AS ENUM ('CLIENT', 'PT', 'GYM', 'PLATFORM');

-- CreateEnum
CREATE TYPE "WalletStatus" AS ENUM ('ACTIVE', 'FROZEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "RelatedEntityType" AS ENUM ('GYM_MEMBERSHIP', 'PT_CONTRACT', 'WALLET_TOPUP');

-- CreateEnum
CREATE TYPE "ActivationStatus" AS ENUM ('NOT_APPLICABLE', 'PENDING', 'ACTIVATED', 'ACTIVATION_FAILED');

-- CreateTable
CREATE TABLE "wallets" (
    "id"                TEXT NOT NULL,
    "owner_type"        "WalletOwnerType" NOT NULL,
    "owner_id"          TEXT NOT NULL,
    "available_balance" DECIMAL(14, 2) NOT NULL DEFAULT 0,
    "locked_balance"    DECIMAL(14, 2) NOT NULL DEFAULT 0,
    "status"            "WalletStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_ledger_entries" (
    "id"             TEXT NOT NULL,
    "wallet_id"      TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "entry_type"     "LedgerEntryType" NOT NULL,
    "amount"         DECIMAL(14, 2) NOT NULL,
    "balance_before" DECIMAL(14, 2) NOT NULL,
    "balance_after"  DECIMAL(14, 2) NOT NULL,
    "description"    TEXT,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallets_owner_type_owner_id_key" ON "wallets"("owner_type", "owner_id");

-- CreateIndex
CREATE INDEX "wallet_ledger_entries_wallet_id_created_at_idx" ON "wallet_ledger_entries"("wallet_id", "created_at");

-- CreateIndex
CREATE INDEX "wallet_ledger_entries_transaction_id_idx" ON "wallet_ledger_entries"("transaction_id");

-- AddForeignKey
ALTER TABLE "wallet_ledger_entries" ADD CONSTRAINT "wallet_ledger_entries_wallet_id_fkey"
    FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_ledger_entries" ADD CONSTRAINT "wallet_ledger_entries_transaction_id_fkey"
    FOREIGN KEY ("transaction_id") REFERENCES "payment_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: extend payment_transactions with wallet/activation/audit fields.
-- initiated_by / source_service are nullable-with-default so existing Phase B rows
-- backfill automatically instead of failing a NOT NULL migration.
ALTER TABLE "payment_transactions"
    ADD COLUMN "request_fingerprint"      TEXT,
    ADD COLUMN "payer_wallet_id"          TEXT,
    ADD COLUMN "receiver_wallet_id"       TEXT,
    ADD COLUMN "related_entity_type"      "RelatedEntityType",
    ADD COLUMN "related_entity_id"        TEXT,
    ADD COLUMN "activation_status"        "ActivationStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
    ADD COLUMN "activation_retry_count"   INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "last_activation_retry_at" TIMESTAMP(3),
    ADD COLUMN "initiated_by"             TEXT DEFAULT 'SYSTEM',
    ADD COLUMN "source_service"           TEXT DEFAULT 'payment-service',
    ADD COLUMN "refund_of_transaction_id" TEXT;

-- CreateIndex
CREATE INDEX "payment_transactions_purpose_status_activation_status_idx" ON "payment_transactions"("purpose", "status", "activation_status");

-- CreateIndex
CREATE INDEX "payment_transactions_refund_of_transaction_id_idx" ON "payment_transactions"("refund_of_transaction_id");
