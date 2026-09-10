-- Phase 1 — Nền tảng danh tính đối tác phòng tập.
--
-- Tách pháp nhân đối tác (GymPartner) khỏi tài khoản đăng nhập (GymPartnerAccount).
-- KHÔNG dựng lại vai trò GYM_STAFF: vai trò ở tầng xác thực vẫn đúng một giá trị
-- GYM_OWNER cho mọi tài khoản đối tác; PartnerAccountRole dưới đây là quyền BÊN TRONG
-- một đối tác, do gym-service tự phân giải.

CREATE TYPE "GymPartnerStatus" AS ENUM ('PROSPECT', 'INVITED', 'ACTIVE', 'SUSPENDED', 'TERMINATED');
CREATE TYPE "GymPartnerKind" AS ENUM ('BUSINESS', 'INDIVIDUAL');
CREATE TYPE "PartnerAccountRole" AS ENUM ('OWNER', 'MANAGER');
CREATE TYPE "PartnerAccountStatus" AS ENUM ('INVITED', 'ACTIVE', 'REVOKED');
CREATE TYPE "PartnerInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

CREATE TABLE "gym_partners" (
    "id" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "partner_kind" "GymPartnerKind" NOT NULL DEFAULT 'BUSINESS',
    "tax_code" TEXT,
    "business_license_no" TEXT,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "status" "GymPartnerStatus" NOT NULL DEFAULT 'PROSPECT',
    "brand_id" TEXT,
    "commission_rate_override" DECIMAL(5,4),
    "suspended_at" TIMESTAMP(3),
    "suspended_reason" TEXT,
    "suspended_by" TEXT,
    "terminated_at" TIMESTAMP(3),
    "termination_reason" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gym_partners_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "gym_partner_accounts" (
    "id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "PartnerAccountRole" NOT NULL,
    "scoped_gym_ids" TEXT[],
    "status" "PartnerAccountStatus" NOT NULL DEFAULT 'INVITED',
    "invited_by" TEXT,
    "invited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gym_partner_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "partner_invitations" (
    "id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "PartnerAccountRole" NOT NULL,
    "scoped_gym_ids" TEXT[],
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "status" "PartnerInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "sent_count" INTEGER NOT NULL DEFAULT 1,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMP(3),

    CONSTRAINT "partner_invitations_pkey" PRIMARY KEY ("id")
);

-- Bất biến 2: mỗi đối tác TỐI ĐA một thương hiệu (nhiều NULL vẫn hợp lệ trong Postgres,
-- đúng ý — đối tác chưa đặt tên thương hiệu thì brand_id còn null).
CREATE UNIQUE INDEX "gym_partners_brand_id_key" ON "gym_partners"("brand_id");
CREATE INDEX "gym_partners_status_idx" ON "gym_partners"("status");

-- Bất biến 3: một userId chỉ thuộc TỐI ĐA một đối tác.
CREATE UNIQUE INDEX "gym_partner_accounts_user_id_key" ON "gym_partner_accounts"("user_id");
CREATE INDEX "gym_partner_accounts_partner_id_status_idx" ON "gym_partner_accounts"("partner_id", "status");

CREATE UNIQUE INDEX "partner_invitations_token_hash_key" ON "partner_invitations"("token_hash");
CREATE INDEX "partner_invitations_partner_id_status_idx" ON "partner_invitations"("partner_id", "status");
CREATE INDEX "partner_invitations_email_idx" ON "partner_invitations"("email");

ALTER TABLE "gym_partner_accounts" ADD CONSTRAINT "gym_partner_accounts_partner_id_fkey"
    FOREIGN KEY ("partner_id") REFERENCES "gym_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "partner_invitations" ADD CONSTRAINT "partner_invitations_partner_id_fkey"
    FOREIGN KEY ("partner_id") REFERENCES "gym_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Bất biến 1: mỗi đối tác có ĐÚNG MỘT tài khoản OWNER đang hoạt động.
-- Partial unique index — Prisma schema không diễn đạt được nên khai báo thẳng ở đây.
-- Kiểm ở tầng service là chưa đủ: hai yêu cầu đồng thời đều đọc thấy "chưa có OWNER nào"
-- rồi cùng ghi. Ràng buộc này khiến yêu cầu thứ hai thất bại ở tầng CSDL.
CREATE UNIQUE INDEX "gym_partner_accounts_one_active_owner"
    ON "gym_partner_accounts"("partner_id")
    WHERE "role" = 'OWNER' AND "status" = 'ACTIVE';

-- Bất biến 4: MANAGER phải có ít nhất một chi nhánh trong scoped_gym_ids.
-- MANAGER không gán chi nhánh nào là một tài khoản không làm được gì mà vẫn đăng nhập
-- được — trạng thái đó không nên tồn tại.
ALTER TABLE "gym_partner_accounts" ADD CONSTRAINT "gym_partner_accounts_manager_needs_scope"
    CHECK ("role" <> 'MANAGER' OR COALESCE(array_length("scoped_gym_ids", 1), 0) >= 1);

-- ── Backfill: mỗi chủ gym đang có sẵn trở thành một đối tác ACTIVE ───────────
--
-- Không backfill thì các chủ gym hiện tại không có hồ sơ đối tác, sẽ không xuất hiện ở
-- màn hình quản trị của Phase 2. Tầng phân giải danh tính (partner-context.middleware)
-- vẫn có nhánh dự phòng cho tài khoản không có hồ sơ đối tác, nhưng để dữ liệu nhất
-- quán ngay từ đầu thì tốt hơn là dựa vào nhánh dự phòng đó mãi.
--
-- legal_name lấy tạm theo tên thương hiệu (hoặc tên chi nhánh đầu tiên) — gym-service
-- không hề lưu tên pháp lý hay email của chủ gym, nên admin sẽ bổ sung sau ở Phase 4.
-- partner_kind mặc định INDIVIDUAL: đoán "hộ cá nhân" cho dữ liệu cũ an toàn hơn đoán
-- "doanh nghiệp" rồi bịa ra một pháp nhân không tồn tại.
DO $$
DECLARE
    owner_row RECORD;
    new_partner_id TEXT;
    picked_brand_id TEXT;
    picked_name TEXT;
BEGIN
    FOR owner_row IN
        SELECT owner_id FROM gyms
        UNION
        SELECT owner_id FROM gym_brands
    LOOP
        -- Chọn thương hiệu sớm nhất nếu vì lý do nào đó chủ này có nhiều hơn một
        -- (ràng buộc "một chủ một thương hiệu" chỉ mới có ở tầng service, dữ liệu cũ
        -- có thể vi phạm) — unique index trên brand_id ở trên sẽ nổ nếu gán bừa.
        SELECT id, name INTO picked_brand_id, picked_name
        FROM gym_brands WHERE owner_id = owner_row.owner_id
        ORDER BY created_at ASC LIMIT 1;

        IF picked_name IS NULL THEN
            SELECT name INTO picked_name FROM gyms
            WHERE owner_id = owner_row.owner_id ORDER BY created_at ASC LIMIT 1;
        END IF;

        new_partner_id := gen_random_uuid()::TEXT;

        INSERT INTO gym_partners (id, legal_name, partner_kind, status, brand_id, created_at, updated_at)
        VALUES (
            new_partner_id,
            COALESCE(picked_name, 'Đối tác chưa đặt tên'),
            'INDIVIDUAL',
            'ACTIVE',
            picked_brand_id,
            NOW(),
            NOW()
        );

        INSERT INTO gym_partner_accounts (id, partner_id, user_id, role, scoped_gym_ids, status, invited_at, activated_at, created_at, updated_at)
        VALUES (
            gen_random_uuid()::TEXT,
            new_partner_id,
            owner_row.owner_id,
            'OWNER',
            '{}',
            'ACTIVE',
            NOW(),
            NOW(),
            NOW(),
            NOW()
        );

        picked_brand_id := NULL;
        picked_name := NULL;
    END LOOP;
END $$;
