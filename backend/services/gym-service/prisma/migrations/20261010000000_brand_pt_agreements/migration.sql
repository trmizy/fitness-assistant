-- Thoả thuận chia sẻ doanh thu Gym–PT cấp THƯƠNG HIỆU (một thoả thuận cho mỗi cặp (brand, PT),
-- áp cho mọi chi nhánh đang hoạt động của thương hiệu). Xem docs/GYM_PT_BRAND_PARTNERSHIP_AUDIT.md §C.
--
-- Viết tay, CHỈ CỘNG THÊM (bảng mới + cột nullable). Chưa có mã nào đọc các bảng này: hành vi dịch vụ
-- không đổi. `gym_pt_collaborations` vẫn là nguồn điều khoản cũ và KHÔNG bị sửa điều khoản nào.
-- Việc điền dữ liệu KHÔNG nằm ở đây (migration tự chạy lúc khởi động container, không có chế độ
-- chạy thử) — dùng src/scripts/backfill-brand-pt-agreements.ts (mặc định chạy thử).
--
-- Dùng lại kiểu enum sẵn có "CollaborationStatus" / "CollaborationParty" (cùng vòng đời thương thảo).

-- CreateTable
CREATE TABLE "gym_brand_pt_agreements" (
    "id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "pt_user_id" TEXT NOT NULL,
    "proposed_pt_rate" DECIMAL(6,4) NOT NULL,
    "proposed_gym_rate" DECIMAL(6,4) NOT NULL,
    "platform_rate" DECIMAL(6,4) NOT NULL DEFAULT 0.10,
    "status" "CollaborationStatus" NOT NULL DEFAULT 'PENDING',
    "proposed_by" "CollaborationParty" NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "termination_initiated_at" TIMESTAMP(3),
    "effective_at" TIMESTAMP(3),
    "terminated_at" TIMESTAMP(3),
    "terminated_by" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'NATIVE',
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gym_brand_pt_agreements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "gym_brand_pt_agreements_origin_check" CHECK ("origin" IN ('NATIVE', 'MIGRATED'))
);

-- CreateTable
CREATE TABLE "gym_pt_agreement_conflicts" (
    "id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "pt_user_id" TEXT NOT NULL,
    "legacy_collaboration_ids" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolved_agreement_id" TEXT,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "gym_pt_agreement_conflicts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "gym_pt_agreement_conflicts_status_check" CHECK ("status" IN ('OPEN', 'RESOLVED'))
);

-- AlterTable: cột đánh dấu trên bảng cũ, đều nullable; dòng cũ để NULL.
ALTER TABLE "gym_pt_collaborations"
    ADD COLUMN "superseded_by_agreement_id" TEXT,
    ADD COLUMN "superseded_at" TIMESTAMP(3),
    ADD COLUMN "termination_initiated_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "gym_brand_pt_agreements_pt_user_id_status_idx" ON "gym_brand_pt_agreements"("pt_user_id", "status");

-- CreateIndex
CREATE INDEX "gym_brand_pt_agreements_brand_id_status_idx" ON "gym_brand_pt_agreements"("brand_id", "status");

-- CreateIndex
CREATE INDEX "gym_pt_agreement_conflicts_pt_user_id_idx" ON "gym_pt_agreement_conflicts"("pt_user_id");

-- CreateIndex
CREATE INDEX "gym_pt_collaborations_superseded_by_agreement_id_idx" ON "gym_pt_collaborations"("superseded_by_agreement_id");

-- Chỉ mục duy nhất MỘT PHẦN — Prisma không biểu diễn được trong schema.prisma (cùng loại với
-- gym_pt_collaborations_accepted_pair_key): mỗi cặp (brand, PT) chỉ có tối đa MỘT thoả thuận ACCEPTED...
CREATE UNIQUE INDEX "gym_brand_pt_agreements_accepted_pair_key"
  ON "gym_brand_pt_agreements" ("brand_id", "pt_user_id")
  WHERE "status" = 'ACCEPTED';

-- ...và tối đa MỘT thương thảo đang mở. Bảng cũ chỉ kiểm điều này ở tầng ứng dụng; ở bảng mới
-- DB là chốt chặn cuối ngay từ đầu.
CREATE UNIQUE INDEX "gym_brand_pt_agreements_open_pair_key"
  ON "gym_brand_pt_agreements" ("brand_id", "pt_user_id")
  WHERE "status" IN ('PENDING', 'COUNTERED');

-- Mỗi cặp chỉ có tối đa một xung đột đang MỞ (xung đột đã giải quyết được giữ lại làm lịch sử).
CREATE UNIQUE INDEX "gym_pt_agreement_conflicts_open_pair_key"
  ON "gym_pt_agreement_conflicts" ("brand_id", "pt_user_id")
  WHERE "status" = 'OPEN';

-- AddForeignKey: RESTRICT — thoả thuận là dữ liệu tiền, không để xoá thương hiệu kéo theo mất thoả thuận.
ALTER TABLE "gym_brand_pt_agreements" ADD CONSTRAINT "gym_brand_pt_agreements_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "gym_brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: bản ghi xung đột chỉ là dữ liệu dẫn xuất (sinh lại được bằng script) nên đi theo thương hiệu.
ALTER TABLE "gym_pt_agreement_conflicts" ADD CONSTRAINT "gym_pt_agreement_conflicts_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "gym_brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: SET NULL — xoá một thoả thuận (lùi lại) không bao giờ để dòng cũ trỏ vào hư không.
ALTER TABLE "gym_pt_collaborations" ADD CONSTRAINT "gym_pt_collaborations_superseded_by_agreement_id_fkey" FOREIGN KEY ("superseded_by_agreement_id") REFERENCES "gym_brand_pt_agreements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gym_pt_agreement_conflicts" ADD CONSTRAINT "gym_pt_agreement_conflicts_resolved_agreement_id_fkey" FOREIGN KEY ("resolved_agreement_id") REFERENCES "gym_brand_pt_agreements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
