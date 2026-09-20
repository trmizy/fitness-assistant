-- GYM_PARTNER_SELF_ONBOARDING_SPEC.md — hồ sơ đối tác tự đăng ký.
--
-- Chỉ CỘNG THÊM: không xoá cột/enum/bảng nào, không đổi dữ liệu có sẵn.
--   * Mọi gym_partners hiện có mặc định source = ADMIN_CREATED (đúng thực tế: do admin nhập).
--   * Mọi gym_photos hiện có mặc định visibility = PUBLIC (ảnh đĩa cũ, đã công khai từ trước).
--   * gym_brands.owner_id chuyển từ index thường sang UNIQUE — đã kiểm trên DB dev: 5 brand /
--     5 owner_id khác nhau, không có dòng trùng nào phải xử lý.

-- CreateEnum
CREATE TYPE "GymPartnerSource" AS ENUM ('ADMIN_CREATED', 'SELF_SERVICE');

-- CreateEnum
CREATE TYPE "PartnerRepresentativeRole" AS ENUM ('GYM_OWNER', 'CO_FOUNDER', 'LEGAL_REPRESENTATIVE', 'AUTHORIZED_MANAGER');

-- CreateEnum
CREATE TYPE "PartnerBusinessScale" AS ENUM ('ONE_BRANCH', 'MULTIPLE_BRANCHES');

-- CreateEnum
CREATE TYPE "PartnerReviewCategory" AS ENUM ('REPRESENTATIVE', 'BRAND', 'BRANCH', 'LOCATION', 'PHOTOS', 'LEGAL', 'OTHER');

-- CreateEnum
CREATE TYPE "PartnerReviewIssueStatus" AS ENUM ('OPEN', 'RESUBMITTED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "GymPhotoCategory" AS ENUM ('EXTERIOR', 'MAIN_TRAINING_AREA', 'EQUIPMENT', 'CARDIO', 'CHANGING_ROOM', 'AMENITIES', 'OTHER');

-- CreateEnum
CREATE TYPE "GymPhotoVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "PartnerUploadKind" AS ENUM ('DOCUMENT', 'PHOTO');

-- AlterEnum (giá trị mới chưa được dùng trong chính migration này)
ALTER TYPE "PartnerAuditAction" ADD VALUE 'APPLICATION_SUBMITTED';
ALTER TYPE "PartnerAuditAction" ADD VALUE 'CHANGES_REQUESTED';
ALTER TYPE "PartnerAuditAction" ADD VALUE 'ISSUE_MARKED_UPDATED';
ALTER TYPE "PartnerAuditAction" ADD VALUE 'APPLICATION_RESUBMITTED';
ALTER TYPE "PartnerAuditAction" ADD VALUE 'ISSUE_RESOLVED';
ALTER TYPE "PartnerAuditAction" ADD VALUE 'DOCUMENT_UPLOADED';
ALTER TYPE "PartnerAuditAction" ADD VALUE 'DOCUMENT_REPLACED';
ALTER TYPE "PartnerAuditAction" ADD VALUE 'DOCUMENT_ACCEPTED';
ALTER TYPE "PartnerAuditAction" ADD VALUE 'DOCUMENT_UPDATE_REQUESTED';
ALTER TYPE "PartnerAuditAction" ADD VALUE 'APPLICATION_APPROVED';
ALTER TYPE "PartnerAuditAction" ADD VALUE 'APPLICATION_REJECTED';
ALTER TYPE "PartnerAuditAction" ADD VALUE 'APPLICATION_REOPENED';

-- AlterTable
ALTER TABLE "gym_partners"
    ADD COLUMN "source" "GymPartnerSource" NOT NULL DEFAULT 'ADMIN_CREATED',
    ADD COLUMN "submitted_at" TIMESTAMP(3),
    ADD COLUMN "representative_name" TEXT,
    ADD COLUMN "representative_role" "PartnerRepresentativeRole",
    ADD COLUMN "business_scale" "PartnerBusinessScale";

-- AlterTable
ALTER TABLE "gym_partner_documents"
    ADD COLUMN "file_key" TEXT,
    ADD COLUMN "mime_type" TEXT,
    ADD COLUMN "size_bytes" INTEGER,
    ADD COLUMN "uploaded_by" TEXT,
    ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "review_note" TEXT;

-- AlterTable
ALTER TABLE "gym_brands" ADD COLUMN "logo_key" TEXT;

-- AlterTable
ALTER TABLE "gym_photos"
    ADD COLUMN "s3_key" TEXT,
    ADD COLUMN "category" "GymPhotoCategory",
    ADD COLUMN "visibility" "GymPhotoVisibility" NOT NULL DEFAULT 'PUBLIC';

-- Bất biến "1 Owner = đúng 1 Brand" ở cấp DB.
DROP INDEX "gym_brands_owner_id_idx";
CREATE UNIQUE INDEX "gym_brands_owner_id_key" ON "gym_brands"("owner_id");

-- CreateTable
CREATE TABLE "gym_partner_review_issues" (
    "id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "category" "PartnerReviewCategory" NOT NULL,
    "message" TEXT NOT NULL,
    "status" "PartnerReviewIssueStatus" NOT NULL DEFAULT 'OPEN',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resubmit_note" TEXT,
    "resubmitted_at" TIMESTAMP(3),
    "admin_follow_up" TEXT,
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "gym_partner_review_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_upload_intents" (
    "id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "kind" "PartnerUploadKind" NOT NULL,
    "doc_type" "PartnerDocumentType",
    "gym_id" TEXT,
    "photo_category" "GymPhotoCategory",
    "object_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "max_bytes" INTEGER NOT NULL,
    "created_by" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_upload_intents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gym_partner_review_issues_partner_id_status_idx" ON "gym_partner_review_issues"("partner_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "partner_upload_intents_object_key_key" ON "partner_upload_intents"("object_key");

-- CreateIndex
CREATE INDEX "partner_upload_intents_partner_id_kind_idx" ON "partner_upload_intents"("partner_id", "kind");

-- AddForeignKey
ALTER TABLE "gym_partner_review_issues" ADD CONSTRAINT "gym_partner_review_issues_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "gym_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_upload_intents" ADD CONSTRAINT "partner_upload_intents_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "gym_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
