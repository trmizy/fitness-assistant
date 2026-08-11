-- CreateTable
CREATE TABLE "partner_receivables" (
    "id" TEXT NOT NULL,
    "partner_type" "PartnerType" NOT NULL,
    "partner_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "recovered" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "contract_id" TEXT,
    "transaction_id" TEXT,
    "settled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_receivables_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "partner_receivables_partner_type_partner_id_settled_at_idx" ON "partner_receivables"("partner_type", "partner_id", "settled_at");
