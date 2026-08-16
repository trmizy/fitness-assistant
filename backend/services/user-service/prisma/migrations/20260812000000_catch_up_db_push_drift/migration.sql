-- Catch-up migration for schema drift accumulated under the old `prisma db push --accept-data-loss`
-- workflow (see Dockerfile.dev history — switched to `migrate deploy`). Every object below was
-- already created directly against the real databases by `db push`, so this file has two jobs at
-- once: (a) bring a genuinely fresh/CI database from the pre-drift migration history up to the
-- current schema.prisma, and (b) replay as a safe no-op against a database that already has all of
-- it. Every statement is therefore written defensively (IF NOT EXISTS / DO-block existence checks)
-- instead of the plain form `prisma migrate diff` generates. Verified: on the real dev database
-- every single object this file touches already existed before this rewrite (checked via
-- pg_type/information_schema/pg_constraint/pg_indexes), so this file is a documented no-op there
-- and a from-scratch builder everywhere else.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "TerminationReason" AS ENUM ('CLIENT_CANCELLED', 'PT_BANNED', 'PT_CANCELLED', 'MUTUAL', 'EXPIRED', 'COMPLETED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "RescheduleStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "RescheduleRequestedBy" AS ENUM ('CLIENT', 'PT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterEnum (PG12+ supports IF NOT EXISTS directly, and — unlike PG<12 — this is allowed inside
-- the migration's transaction)
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'SESSION_RESCHEDULE_REQUESTED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'SESSION_RESCHEDULE_ACCEPTED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'SESSION_RESCHEDULE_REJECTED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'SESSION_RESCHEDULE_EXPIRED';

-- DropForeignKey + AddForeignKey: schema.prisma wants ON DELETE RESTRICT. Only touch the
-- constraint if it's missing or still has the old delete rule — on the dev database it is
-- already RESTRICT ('r'), so this is a no-op there.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pt_applications_user_profile_id_fkey' AND confdeltype <> 'r'
  ) THEN
    ALTER TABLE "pt_applications" DROP CONSTRAINT "pt_applications_user_profile_id_fkey";
    ALTER TABLE "pt_applications" ADD CONSTRAINT "pt_applications_user_profile_id_fkey" FOREIGN KEY ("user_profile_id") REFERENCES "user_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pt_applications_user_profile_id_fkey'
  ) THEN
    ALTER TABLE "pt_applications" ADD CONSTRAINT "pt_applications_user_profile_id_fkey" FOREIGN KEY ("user_profile_id") REFERENCES "user_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AlterTable
ALTER TABLE "contracts"
  ADD COLUMN IF NOT EXISTS "client_signed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "client_signer_email" TEXT,
  ADD COLUMN IF NOT EXISTS "contract_pdf_path" TEXT,
  ADD COLUMN IF NOT EXISTS "esign_error" TEXT,
  ADD COLUMN IF NOT EXISTS "esign_provider" TEXT,
  ADD COLUMN IF NOT EXISTS "esign_request_id" TEXT,
  ADD COLUMN IF NOT EXISTS "esign_sent_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "esign_status" TEXT,
  ADD COLUMN IF NOT EXISTS "esign_test_mode" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "fully_signed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "gym_rate" DECIMAL(6,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "low_availability_warned" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "package_id" TEXT,
  ADD COLUMN IF NOT EXISTS "package_source_name" TEXT,
  ADD COLUMN IF NOT EXISTS "platform_rate" DECIMAL(6,4) NOT NULL DEFAULT 0.10,
  ADD COLUMN IF NOT EXISTS "pt_rate" DECIMAL(6,4) NOT NULL DEFAULT 0.90,
  ADD COLUMN IF NOT EXISTS "pt_signed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pt_signer_email" TEXT,
  ADD COLUMN IF NOT EXISTS "released_to_gym" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "released_to_platform" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "released_to_pt" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "session_duration_minutes" INTEGER,
  ADD COLUMN IF NOT EXISTS "signed_pdf_url" TEXT,
  ADD COLUMN IF NOT EXISTS "slots_at_purchase" INTEGER,
  ADD COLUMN IF NOT EXISTS "terminated_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "termination_reason" "TerminationReason";

-- Re-casting a column to the type it already has is a safe no-op in Postgres (no error, and with
-- no rows changing shape there's nothing to rewrite), so these are left unconditional.
ALTER TABLE "contracts" ALTER COLUMN "price" SET DATA TYPE DECIMAL(14,2);
ALTER TABLE "contracts" ALTER COLUMN "price_per_session" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "pt_applications"
  ADD COLUMN IF NOT EXISTS "application_training_locations" JSONB,
  ADD COLUMN IF NOT EXISTS "residence_address_line" TEXT,
  ADD COLUMN IF NOT EXISTS "residence_legacy_district_name" TEXT,
  ADD COLUMN IF NOT EXISTS "residence_province_code" INTEGER,
  ADD COLUMN IF NOT EXISTS "residence_ward_code" INTEGER;

-- AlterTable
ALTER TABLE "user_profiles"
  ADD COLUMN IF NOT EXISTS "dietary_preference" TEXT,
  ADD COLUMN IF NOT EXISTS "first_name_normalized" TEXT,
  ADD COLUMN IF NOT EXISTS "gym_id" TEXT,
  ADD COLUMN IF NOT EXISTS "is_accepting_clients" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "last_name_normalized" TEXT,
  ADD COLUMN IF NOT EXISTS "not_accepting_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "photo_url" TEXT,
  ADD COLUMN IF NOT EXISTS "pt_suspended" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "referral_code" TEXT,
  ADD COLUMN IF NOT EXISTS "search_city" TEXT,
  ADD COLUMN IF NOT EXISTS "search_district" TEXT,
  ADD COLUMN IF NOT EXISTS "search_ward" TEXT,
  ADD COLUMN IF NOT EXISTS "specialties" TEXT[];

-- CreateTable
CREATE TABLE IF NOT EXISTS "vietnam_provinces" (
    "code" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "name_normalized" TEXT NOT NULL,
    "codename" TEXT,
    "division_type" TEXT,
    "phone_code" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vietnam_provinces_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "vietnam_wards" (
    "code" INTEGER NOT NULL,
    "province_code" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "name_normalized" TEXT NOT NULL,
    "codename" TEXT,
    "division_type" TEXT,
    "short_codename" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vietnam_wards_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "pt_training_locations" (
    "id" TEXT NOT NULL,
    "pt_user_id" TEXT NOT NULL,
    "province_code" INTEGER NOT NULL,
    "ward_code" INTEGER,
    "gym_name" TEXT,
    "gym_name_normalized" TEXT,
    "address_line" TEXT,
    "legacy_district_name" TEXT,
    "gym_id" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pt_training_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "pt_service_packages" (
    "id" TEXT NOT NULL,
    "pt_user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "session_count" INTEGER NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "session_mode" "SessionMode" NOT NULL,
    "session_duration_minutes" INTEGER NOT NULL DEFAULT 60,
    "validity_days" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pt_service_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "session_reschedule_requests" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "requested_by" "RescheduleRequestedBy" NOT NULL,
    "original_start_at" TIMESTAMP(3) NOT NULL,
    "original_end_at" TIMESTAMP(3) NOT NULL,
    "proposed_start_at" TIMESTAMP(3) NOT NULL,
    "proposed_end_at" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RescheduleStatus" NOT NULL DEFAULT 'PENDING',
    "responded_at" TIMESTAMP(3),
    "response_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_reschedule_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "vietnam_provinces_name_idx" ON "vietnam_provinces"("name");
CREATE INDEX IF NOT EXISTS "vietnam_provinces_name_normalized_idx" ON "vietnam_provinces"("name_normalized");
CREATE INDEX IF NOT EXISTS "vietnam_provinces_codename_idx" ON "vietnam_provinces"("codename");
CREATE INDEX IF NOT EXISTS "vietnam_wards_province_code_idx" ON "vietnam_wards"("province_code");
CREATE INDEX IF NOT EXISTS "vietnam_wards_name_idx" ON "vietnam_wards"("name");
CREATE INDEX IF NOT EXISTS "vietnam_wards_name_normalized_idx" ON "vietnam_wards"("name_normalized");
CREATE INDEX IF NOT EXISTS "vietnam_wards_codename_idx" ON "vietnam_wards"("codename");
CREATE INDEX IF NOT EXISTS "pt_training_locations_pt_user_id_idx" ON "pt_training_locations"("pt_user_id");
CREATE INDEX IF NOT EXISTS "pt_training_locations_province_code_idx" ON "pt_training_locations"("province_code");
CREATE INDEX IF NOT EXISTS "pt_training_locations_ward_code_idx" ON "pt_training_locations"("ward_code");
CREATE INDEX IF NOT EXISTS "pt_training_locations_is_active_idx" ON "pt_training_locations"("is_active");
CREATE INDEX IF NOT EXISTS "pt_training_locations_gym_id_idx" ON "pt_training_locations"("gym_id");
CREATE INDEX IF NOT EXISTS "pt_service_packages_pt_user_id_is_active_idx" ON "pt_service_packages"("pt_user_id", "is_active");
CREATE INDEX IF NOT EXISTS "session_reschedule_requests_session_id_status_idx" ON "session_reschedule_requests"("session_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "user_profiles_referral_code_key" ON "user_profiles"("referral_code");

-- AddForeignKey (each guarded — Postgres has no `ADD CONSTRAINT IF NOT EXISTS`)
DO $$ BEGIN
  ALTER TABLE "vietnam_wards" ADD CONSTRAINT "vietnam_wards_province_code_fkey" FOREIGN KEY ("province_code") REFERENCES "vietnam_provinces"("code") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "pt_training_locations" ADD CONSTRAINT "pt_training_locations_province_code_fkey" FOREIGN KEY ("province_code") REFERENCES "vietnam_provinces"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "pt_training_locations" ADD CONSTRAINT "pt_training_locations_ward_code_fkey" FOREIGN KEY ("ward_code") REFERENCES "vietnam_wards"("code") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "pt_training_locations" ADD CONSTRAINT "pt_training_locations_pt_user_id_fkey" FOREIGN KEY ("pt_user_id") REFERENCES "user_profiles"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "pt_service_packages" ADD CONSTRAINT "pt_service_packages_pt_user_id_fkey" FOREIGN KEY ("pt_user_id") REFERENCES "user_profiles"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "session_reschedule_requests" ADD CONSTRAINT "session_reschedule_requests_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
