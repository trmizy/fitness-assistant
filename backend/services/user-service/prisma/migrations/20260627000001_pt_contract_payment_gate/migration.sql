-- Extend ContractStatus with PENDING_PAYMENT (CREATE TYPE + RENAME — same transaction-safe
-- pattern used for the auth Role enum migration). This only adds an enum value; it does not
-- rewrite any row's status column, so every contract currently ACTIVE (or any other existing
-- status) stays exactly as it is — only new transitions can ever land on PENDING_PAYMENT.
CREATE TYPE "ContractStatus_new" AS ENUM (
  'PENDING_REVIEW', 'PENDING_SIGNATURE', 'PENDING_PAYMENT', 'ACTIVE', 'COMPLETED', 'EXPIRED', 'CANCELLED', 'REJECTED'
);
ALTER TABLE "contracts" ALTER COLUMN "status" TYPE "ContractStatus_new" USING ("status"::text::"ContractStatus_new");
ALTER TABLE "contracts" ALTER COLUMN "status" SET DEFAULT 'PENDING_REVIEW';
DROP TYPE "ContractStatus";
ALTER TYPE "ContractStatus_new" RENAME TO "ContractStatus";

-- CreateEnum
CREATE TYPE "ContractSource" AS ENUM ('INDEPENDENT', 'GYM');

-- AlterTable: schema-ready for the PT-via-gym relation (enforcement is a follow-up phase) —
-- ADD COLUMN nullable/defaulted, safe, no data loss, existing contracts unaffected.
ALTER TABLE "contracts"
    ADD COLUMN "gym_id" TEXT,
    ADD COLUMN "source" "ContractSource" NOT NULL DEFAULT 'INDEPENDENT',
    ADD COLUMN "payment_transaction_id" TEXT;
