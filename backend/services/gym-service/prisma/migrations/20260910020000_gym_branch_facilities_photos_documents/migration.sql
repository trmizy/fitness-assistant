-- GYM_BRANCH_FORM_SPEC.md, Phase 3 — Steps 4-6 (Facilities & Services, Photos, Branch-level
-- Verification Documents). facilities is a fixed enum catalog the owner multi-selects from,
-- same array-column pattern as GymPartnerAccount.scoped_gym_ids — no join table needed at
-- this scale. gym_photos is PUBLIC (marketing gallery, served via express.static, same
-- exposure level as a profile photo) — unlike gym_branch_documents, which stores an opaque
-- file_token served only through an authenticated route, same convention as
-- gym_complaints.photo_tokens. gym_branch_documents reuses "PartnerDocumentStatus" (already
-- created by an earlier migration) rather than defining a duplicate status enum — §95.4:
-- this is explicitly NOT the partner-level verification (business license/tax/rep-identity,
-- collected once at partner vetting) — only location-specific documents for this branch.

-- CreateEnum
CREATE TYPE "GymFacility" AS ENUM ('FREE_WEIGHTS', 'CARDIO_MACHINES', 'FUNCTIONAL_TRAINING_AREA', 'GROUP_CLASSES', 'YOGA_STUDIO', 'SWIMMING_POOL', 'PERSONAL_TRAINER', 'INBODY_SCAN', 'LOCKER_ROOM', 'SHOWER', 'SAUNA', 'TOWEL_SERVICE', 'PARKING', 'WIFI', 'AIR_CONDITIONING', 'DRINKING_WATER', 'KIDS_AREA', 'VENDING_MACHINE');

-- CreateEnum
CREATE TYPE "BranchDocumentType" AS ENUM ('LEASE_OR_PROPERTY_DOC', 'FIRE_SAFETY_CERTIFICATE', 'FACILITY_PHOTOS');

-- AlterTable
ALTER TABLE "gyms" ADD COLUMN     "facilities" "GymFacility"[] NOT NULL DEFAULT ARRAY[]::"GymFacility"[];

-- CreateTable
CREATE TABLE "gym_photos" (
    "id" TEXT NOT NULL,
    "gym_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_cover" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gym_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gym_branch_documents" (
    "id" TEXT NOT NULL,
    "gym_id" TEXT NOT NULL,
    "doc_type" "BranchDocumentType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "file_token" TEXT,
    "status" "PartnerDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "verified_by" TEXT,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gym_branch_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gym_photos_gym_id_sort_order_idx" ON "gym_photos"("gym_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "gym_branch_documents_gym_id_doc_type_key" ON "gym_branch_documents"("gym_id", "doc_type");

-- CreateIndex
CREATE INDEX "gym_branch_documents_gym_id_idx" ON "gym_branch_documents"("gym_id");

-- AddForeignKey
ALTER TABLE "gym_photos" ADD CONSTRAINT "gym_photos_gym_id_fkey" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gym_branch_documents" ADD CONSTRAINT "gym_branch_documents_gym_id_fkey" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
