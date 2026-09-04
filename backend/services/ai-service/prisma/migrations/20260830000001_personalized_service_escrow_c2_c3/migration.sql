-- P0 cluster C2/C3 — Personalized PT Service switches from an instant wallet-to-wallet
-- transfer to real gateway checkout + escrow.

-- AlterTable: add nullable first so existing rows do not need a value up front, backfill
-- existing rows with what the old flow implicitly always charged (DEFAULT_COMMISSION_RATE =
-- 0.10 in payment-service), then enforce NOT NULL for every row going forward.
ALTER TABLE "personalized_service_orders"
  ADD COLUMN "platform_rate_snapshot" DOUBLE PRECISION,
  ADD COLUMN "pt_rate_snapshot" DOUBLE PRECISION,
  ADD COLUMN "released_at" TIMESTAMP(3),
  ADD COLUMN "auto_accept_deadline" TIMESTAMP(3);

UPDATE "personalized_service_orders"
  SET "platform_rate_snapshot" = 0.10, "pt_rate_snapshot" = 0.90
  WHERE "platform_rate_snapshot" IS NULL;

ALTER TABLE "personalized_service_orders"
  ALTER COLUMN "platform_rate_snapshot" SET NOT NULL,
  ALTER COLUMN "pt_rate_snapshot" SET NOT NULL,
  ALTER COLUMN "status" SET DEFAULT 'PENDING_PAYMENT';

-- CreateIndex
CREATE INDEX "personalized_service_orders_status_auto_accept_deadline_idx" ON "personalized_service_orders"("status", "auto_accept_deadline");
