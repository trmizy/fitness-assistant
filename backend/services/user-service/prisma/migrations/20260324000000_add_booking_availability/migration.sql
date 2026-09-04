-- AlterEnum: ContractStatus - rename PENDING to PENDING_REVIEW, add COMPLETED, REJECTED
ALTER TYPE "ContractStatus" RENAME VALUE 'PENDING' TO 'PENDING_REVIEW';
ALTER TYPE "ContractStatus" ADD VALUE 'COMPLETED';
ALTER TYPE "ContractStatus" ADD VALUE 'REJECTED';

-- CreateEnum: PackageType
CREATE TYPE "PackageType" AS ENUM ('PER_SESSION', 'PACKAGE');

-- CreateEnum: SessionStatus
CREATE TYPE "SessionStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum: SessionMode
CREATE TYPE "SessionMode" AS ENUM ('ONLINE', 'OFFLINE', 'HYBRID');

-- CreateEnum: DayOfWeek
CREATE TYPE "DayOfWeek" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateEnum: NotificationEventType
CREATE TYPE "NotificationEventType" AS ENUM ('CONTRACT_REQUESTED', 'CONTRACT_ACCEPTED', 'CONTRACT_REJECTED', 'CONTRACT_CANCELLED', 'SESSION_BOOKED', 'SESSION_CONFIRMED', 'SESSION_COMPLETED', 'SESSION_CANCELLED', 'SESSION_NO_SHOW_CLIENT', 'SESSION_NO_SHOW_PT');

-- CreateEnum: NotificationEntityType
CREATE TYPE "NotificationEntityType" AS ENUM ('CONTRACT', 'SESSION');

-- AlterTable: contracts - add new columns
ALTER TABLE "contracts" ADD COLUMN "package_type" "PackageType" NOT NULL DEFAULT 'PACKAGE';
ALTER TABLE "contracts" ADD COLUMN "price_per_session" DOUBLE PRECISION;
ALTER TABLE "contracts" ADD COLUMN "completed_at" TIMESTAMP(3);
ALTER TABLE "contracts" ADD COLUMN "client_message" TEXT;
ALTER TABLE "contracts" ADD COLUMN "rejection_reason" TEXT;
ALTER TABLE "contracts" ADD COLUMN "cancelled_by" TEXT;
ALTER TABLE "contracts" ADD COLUMN "cancellation_reason" TEXT;

-- CreateIndex: contracts (IF NOT EXISTS to handle pre-existing)
CREATE INDEX IF NOT EXISTS "contracts_status_idx" ON "contracts"("status");

-- CreateTable: sessions
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "client_user_id" TEXT NOT NULL,
    "pt_user_id" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'REQUESTED',
    "session_mode" "SessionMode" NOT NULL DEFAULT 'OFFLINE',
    "scheduled_start_at" TIMESTAMP(3) NOT NULL,
    "scheduled_end_at" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "notes" TEXT,
    "pt_notes" TEXT,
    "cancelled_by" TEXT,
    "cancellation_reason" TEXT,
    "session_deducted" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sessions_contract_id_idx" ON "sessions"("contract_id");
CREATE INDEX "sessions_client_user_id_idx" ON "sessions"("client_user_id");
CREATE INDEX "sessions_pt_user_id_idx" ON "sessions"("pt_user_id");
CREATE INDEX "sessions_scheduled_start_at_idx" ON "sessions"("scheduled_start_at");

-- CreateTable: session_reviews
CREATE TABLE "session_reviews" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "client_user_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "session_reviews_session_id_key" ON "session_reviews"("session_id");
CREATE INDEX "session_reviews_contract_id_idx" ON "session_reviews"("contract_id");

-- Drop old notifications table if exists (old schema had "type" text column, incompatible)
DROP TABLE IF EXISTS "notifications";

-- CreateTable: notifications (with new metadata columns)
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "event_type" "NotificationEventType" NOT NULL,
    "entity_type" "NotificationEntityType" NOT NULL,
    "entity_id" TEXT NOT NULL,
    "link" TEXT,
    "unread" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");
CREATE INDEX "notifications_user_id_unread_idx" ON "notifications"("user_id", "unread");

-- CreateTable: pt_availability
CREATE TABLE "pt_availability" (
    "id" TEXT NOT NULL,
    "pt_user_id" TEXT NOT NULL,
    "day_of_week" "DayOfWeek" NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pt_availability_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pt_availability_pt_user_id_idx" ON "pt_availability"("pt_user_id");

-- CreateTable: pt_schedule_exceptions
CREATE TABLE "pt_schedule_exceptions" (
    "id" TEXT NOT NULL,
    "pt_user_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pt_schedule_exceptions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pt_schedule_exceptions_pt_user_id_date_idx" ON "pt_schedule_exceptions"("pt_user_id", "date");

-- AddForeignKey: sessions -> contracts
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: session_reviews -> sessions
ALTER TABLE "session_reviews" ADD CONSTRAINT "session_reviews_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: session_reviews -> contracts
ALTER TABLE "session_reviews" ADD CONSTRAINT "session_reviews_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
