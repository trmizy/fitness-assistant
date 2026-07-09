-- Baseline PT application and contract objects that later migrations depend on.
-- This keeps a fresh test database migratable without relying on a missing local migration.

CREATE TYPE "PTApplicationStatus" AS ENUM (
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'NEEDS_MORE_INFO',
  'APPROVED',
  'REJECTED'
);

CREATE TYPE "ServiceMode" AS ENUM ('ONLINE', 'OFFLINE', 'HYBRID');
CREATE TYPE "MediaGroupType" AS ENUM ('IDENTITY', 'CERTIFICATE', 'PORTFOLIO');

CREATE TYPE "ContractStatus" AS ENUM (
  'PENDING',
  'PENDING_SIGNATURE',
  'ACTIVE',
  'EXPIRED',
  'CANCELLED'
);

CREATE TABLE "pt_applications" (
  "id" TEXT NOT NULL,
  "user_profile_id" TEXT NOT NULL,
  "status" "PTApplicationStatus" NOT NULL DEFAULT 'DRAFT',
  "phone_number" TEXT,
  "national_id_number" TEXT,
  "current_address" TEXT,
  "id_card_front_url" TEXT,
  "id_card_back_url" TEXT,
  "portrait_photo_url" TEXT,
  "years_of_experience" TEXT,
  "education_background" TEXT,
  "previous_work_experience" TEXT,
  "professional_bio" TEXT,
  "main_specialties" TEXT[],
  "target_client_groups" TEXT[],
  "primary_training_goals" TEXT[],
  "training_methods_approach" TEXT,
  "portfolio_url" TEXT,
  "linkedin_url" TEXT,
  "website_url" TEXT,
  "social_links" JSONB,
  "availability_notes" TEXT,
  "available_time_slots" JSONB,
  "service_mode" "ServiceMode",
  "operating_areas" TEXT[],
  "desired_session_price" DOUBLE PRECISION,
  "available_days" TEXT[],
  "available_from" TEXT,
  "available_until" TEXT,
  "gym_affiliation" TEXT,
  "package_price" DOUBLE PRECISION,
  "monthly_program_price" DOUBLE PRECISION,
  "additional_pricing_notes" TEXT,
  "other_references" TEXT,
  "admin_note" TEXT,
  "rejection_reason" TEXT,
  "submitted_at" TIMESTAMP(3),
  "reviewed_at" TIMESTAMP(3),
  "approved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pt_applications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pt_applications_user_profile_id_key" ON "pt_applications"("user_profile_id");

ALTER TABLE "pt_applications"
  ADD CONSTRAINT "pt_applications_user_profile_id_fkey"
  FOREIGN KEY ("user_profile_id") REFERENCES "user_profiles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "pt_application_certificates" (
  "id" TEXT NOT NULL,
  "application_id" TEXT NOT NULL,
  "certificate_name" TEXT NOT NULL,
  "issuing_organization" TEXT NOT NULL,
  "is_currently_valid" BOOLEAN NOT NULL,
  "certification_status" TEXT,
  "issue_date" TIMESTAMP(3),
  "expiration_date" TIMESTAMP(3),
  "certificate_file_url" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pt_application_certificates_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "pt_application_certificates"
  ADD CONSTRAINT "pt_application_certificates_application_id_fkey"
  FOREIGN KEY ("application_id") REFERENCES "pt_applications"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "pt_application_media" (
  "id" TEXT NOT NULL,
  "application_id" TEXT NOT NULL,
  "group_type" "MediaGroupType" NOT NULL,
  "file_url" TEXT NOT NULL,
  "label" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pt_application_media_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "pt_application_media"
  ADD CONSTRAINT "pt_application_media_application_id_fkey"
  FOREIGN KEY ("application_id") REFERENCES "pt_applications"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "contracts" (
  "id" TEXT NOT NULL,
  "pt_user_id" TEXT NOT NULL,
  "client_user_id" TEXT NOT NULL,
  "status" "ContractStatus" NOT NULL DEFAULT 'PENDING',
  "package_name" TEXT NOT NULL,
  "description" TEXT,
  "total_sessions" INTEGER NOT NULL,
  "used_sessions" INTEGER NOT NULL DEFAULT 0,
  "price" DOUBLE PRECISION,
  "start_date" TIMESTAMP(3),
  "end_date" TIMESTAMP(3),
  "terms" TEXT,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contracts_pt_user_id_idx" ON "contracts"("pt_user_id");
CREATE INDEX "contracts_client_user_id_idx" ON "contracts"("client_user_id");
