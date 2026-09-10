-- Phase 3 (thiết lập lần đầu) + Phase 4 (thẩm định) + Phase 5 (chiết khấu + chấm dứt).

-- ── Phase 5: chiết khấu nền tảng có ngày hiệu lực ────────────────────────────
CREATE TABLE "platform_commission_rates" (
    "id" TEXT NOT NULL,
    "rate" DECIMAL(5,4) NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_commission_rates_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "platform_commission_rates_effective_from_idx" ON "platform_commission_rates"("effective_from");

-- Dòng gốc: 5% có hiệu lực ngay — vẫn bị kẹp lên sàn 0.10 hiện có của hệ thống lúc áp
-- dụng thực tế (xem doc comment ở schema.prisma và membership.service.ts's PLATFORM_RATE).
INSERT INTO "platform_commission_rates" (id, rate, effective_from, created_by, created_at)
VALUES (gen_random_uuid()::text, 0.05, '2026-01-01T00:00:00Z', NULL, NOW());

-- ── Phase 5: chấm dứt hợp tác — chính sách xử lý hội viên còn hạn ────────────
CREATE TYPE "TerminationMemberPolicy" AS ENUM ('SERVE_UNTIL_EXPIRY', 'PRORATED_REFUND');
ALTER TABLE "gym_partners" ADD COLUMN "termination_member_policy" "TerminationMemberPolicy";

-- ── Phase 4: từ chối hồ sơ (mở lại được — không thêm status mới) + điều khoản đã chốt ──
ALTER TABLE "gym_partners" ADD COLUMN "rejected_at" TIMESTAMP(3);
ALTER TABLE "gym_partners" ADD COLUMN "rejection_reason" TEXT;
ALTER TABLE "gym_partners" ADD COLUMN "expected_branch_count" INTEGER;
ALTER TABLE "gym_partners" ADD COLUMN "negotiation_notes" TEXT;

-- ── Phase 3: thanh toán + điều khoản (bước 4-5 của trình thiết lập) ──────────
ALTER TABLE "gym_partners" ADD COLUMN "payout_bank_name" TEXT;
ALTER TABLE "gym_partners" ADD COLUMN "payout_bank_account_number" TEXT;
ALTER TABLE "gym_partners" ADD COLUMN "payout_bank_account_holder" TEXT;
ALTER TABLE "gym_partners" ADD COLUMN "terms_accepted_version" TEXT;
ALTER TABLE "gym_partners" ADD COLUMN "terms_accepted_at" TIMESTAMP(3);

-- ── Phase 3: liên hệ cá nhân + tiến độ thiết lập của từng tài khoản ──────────
ALTER TABLE "gym_partner_accounts" ADD COLUMN "contact_phone" TEXT;
ALTER TABLE "gym_partner_accounts" ADD COLUMN "onboarding_completed_at" TIMESTAMP(3);

-- Tài khoản có sẵn từ Phase 1 (backfill) coi như đã hoàn tất thiết lập — họ đã dùng hệ
-- thống trước khi mô hình đối tác tồn tại, bắt họ đi lại trình thiết lập là vô lý.
UPDATE "gym_partner_accounts" SET "onboarding_completed_at" = NOW() WHERE "activated_at" IS NOT NULL;

-- ── Phase 4: giấy tờ thẩm định ────────────────────────────────────────────────
CREATE TYPE "PartnerDocumentType" AS ENUM (
    'BUSINESS_LICENSE', 'REPRESENTATIVE_ID', 'PREMISES_PROOF',
    'TAX_CODE_CERTIFICATE', 'SITE_PHOTOS', 'FIRE_SAFETY_CERTIFICATE'
);
CREATE TYPE "PartnerDocumentStatus" AS ENUM ('PENDING', 'RECEIVED', 'VERIFIED', 'REJECTED');

CREATE TABLE "gym_partner_documents" (
    "id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "doc_type" "PartnerDocumentType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "file_url" TEXT,
    "status" "PartnerDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "verified_by" TEXT,
    "verified_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gym_partner_documents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "gym_partner_documents_partner_id_doc_type_key" ON "gym_partner_documents"("partner_id", "doc_type");
CREATE INDEX "gym_partner_documents_partner_id_idx" ON "gym_partner_documents"("partner_id");
CREATE INDEX "gym_partner_documents_expires_at_idx" ON "gym_partner_documents"("expires_at");
ALTER TABLE "gym_partner_documents" ADD CONSTRAINT "gym_partner_documents_partner_id_fkey"
    FOREIGN KEY ("partner_id") REFERENCES "gym_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Phase 4: nhật ký trao đổi thủ công ────────────────────────────────────────
CREATE TYPE "PartnerContactChannel" AS ENUM ('EMAIL', 'CALL', 'MEETING', 'OTHER');

CREATE TABLE "gym_partner_contact_logs" (
    "id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "channel" "PartnerContactChannel" NOT NULL,
    "note" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gym_partner_contact_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "gym_partner_contact_logs_partner_id_occurred_at_idx" ON "gym_partner_contact_logs"("partner_id", "occurred_at");
ALTER TABLE "gym_partner_contact_logs" ADD CONSTRAINT "gym_partner_contact_logs_partner_id_fkey"
    FOREIGN KEY ("partner_id") REFERENCES "gym_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
