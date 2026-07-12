-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentProviderType" AS ENUM ('MOCK', 'VNPAY', 'MOMO', 'STRIPE', 'MANUAL_BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "PartnerType" AS ENUM ('GYM', 'PT');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'SETTLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurposeType" AS ENUM ('GYM_MEMBERSHIP', 'PT_CONTRACT', 'GYM_PT_COMBO');

-- CreateTable
CREATE TABLE "payment_transactions" (
    "id"                      TEXT NOT NULL,
    "payer_id"                TEXT NOT NULL,
    "purpose"                 "PurposeType" NOT NULL,
    "gym_id"                  TEXT,
    "pt_id"                   TEXT,
    "membership_id"           TEXT,
    "pt_contract_id"          TEXT,
    "amount"                  DECIMAL(12, 2) NOT NULL,
    "currency"                TEXT NOT NULL DEFAULT 'VND',
    "status"                  "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "provider"                "PaymentProviderType" NOT NULL DEFAULT 'MOCK',
    "provider_transaction_id" TEXT,
    "payment_method"          TEXT,
    "idempotency_key"         TEXT NOT NULL,
    "extra_data"              TEXT,
    "paid_at"                 TIMESTAMP(3),
    "failed_at"               TIMESTAMP(3),
    "refunded_at"             TIMESTAMP(3),
    "metadata"                JSONB,
    "created_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"              TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_commissions" (
    "id"                       TEXT NOT NULL,
    "payment_transaction_id"   TEXT NOT NULL,
    "partner_type"             "PartnerType" NOT NULL,
    "partner_id"               TEXT NOT NULL,
    "gross_amount"             DECIMAL(12, 2) NOT NULL,
    "platform_fee_amount"      DECIMAL(12, 2) NOT NULL,
    "partner_payout_amount"    DECIMAL(12, 2) NOT NULL,
    "commission_rate"          DECIMAL(5, 4) NOT NULL,
    "status"                   "CommissionStatus" NOT NULL DEFAULT 'PENDING',
    "settled_at"               TIMESTAMP(3),
    "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_webhook_events" (
    "id"                       TEXT NOT NULL,
    "provider"                 "PaymentProviderType" NOT NULL,
    "provider_event_id"        TEXT NOT NULL,
    "provider_transaction_id"  TEXT,
    "payload"                  JSONB NOT NULL,
    "processed_at"             TIMESTAMP(3),
    "retry_count"              INTEGER NOT NULL DEFAULT 0,
    "last_retry_at"            TIMESTAMP(3),
    "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_idempotency_key_key" ON "payment_transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "payment_transactions_payer_id_status_idx" ON "payment_transactions"("payer_id", "status");

-- CreateIndex
CREATE INDEX "payment_transactions_status_idx" ON "payment_transactions"("status");

-- CreateIndex
CREATE INDEX "payment_transactions_provider_transaction_id_idx" ON "payment_transactions"("provider_transaction_id");

-- CreateIndex
CREATE INDEX "platform_commissions_partner_type_partner_id_status_idx" ON "platform_commissions"("partner_type", "partner_id", "status");

-- CreateIndex
CREATE INDEX "platform_commissions_payment_transaction_id_idx" ON "platform_commissions"("payment_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_webhook_events_provider_provider_event_id_key" ON "payment_webhook_events"("provider", "provider_event_id");

-- CreateIndex
CREATE INDEX "payment_webhook_events_processed_at_retry_count_idx" ON "payment_webhook_events"("processed_at", "retry_count");

-- AddForeignKey
ALTER TABLE "platform_commissions" ADD CONSTRAINT "platform_commissions_payment_transaction_id_fkey"
    FOREIGN KEY ("payment_transaction_id") REFERENCES "payment_transactions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
