-- D15c — lễ tân check-in hộ hội viên không dùng được QR. TOÀN BỘ ADDITIVE: cột/bảng/kiểu mới, không đổi hay xoá gì đã có.

-- 1. Mã hội viên: cột SINH TỰ ĐỘNG từ client_id (một người một mã, ổn định qua mọi lần gia hạn). 8 ký tự hex IN HOA.
ALTER TABLE "gym_membership_contracts"
  ADD COLUMN "member_code" TEXT GENERATED ALWAYS AS (upper(substr(md5("client_id"), 1, 8))) STORED;
CREATE INDEX "gym_membership_contracts_member_code_idx" ON "gym_membership_contracts"("member_code");

-- 2. Nguồn lượt check-in: mặc định QR (mọi dòng cũ), ASSISTED khi nhân viên quầy check-in hộ.
CREATE TYPE "GymCheckInSource" AS ENUM ('QR', 'ASSISTED');
ALTER TABLE "gym_check_ins" ADD COLUMN "source" "GymCheckInSource" NOT NULL DEFAULT 'QR';
ALTER TABLE "gym_check_ins" ADD COLUMN "assisted_event_id" TEXT;

CREATE TYPE "AssistedCheckInMethod" AS ENUM ('MEMBER_OTP', 'PHOTO_MATCH', 'MANAGER_EXCEPTION');
CREATE TYPE "AssistedCheckInEventType" AS ENUM (
  'MEMBER_SEARCH', 'OTP_SENT', 'OTP_FAILED', 'CHECKIN_SUCCEEDED', 'CHECKIN_REFUSED',
  'EXCEPTION_REQUESTED', 'EXCEPTION_APPROVED', 'EXCEPTION_REJECTED', 'EXCEPTION_EXPIRED'
);
CREATE TYPE "AssistedExceptionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'USED');

-- 3. Sự kiện kiểm toán CHỈ-THÊM.
CREATE TABLE "gym_assisted_checkin_events" (
    "id" TEXT NOT NULL,
    "event_type" "AssistedCheckInEventType" NOT NULL,
    "gym_id" TEXT NOT NULL,
    "staff_user_id" TEXT NOT NULL,
    "staff_role" "PartnerAccountRole",
    "membership_id" TEXT,
    "client_id" TEXT,
    "method" "AssistedCheckInMethod",
    "outcome" TEXT NOT NULL,
    "reason" TEXT,
    "idempotency_key" TEXT,
    "request_hash" TEXT,
    "checkin_id" TEXT,
    "exception_id" TEXT,
    "challenge_id" TEXT,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gym_assisted_checkin_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "gym_assisted_checkin_events_gym_id_created_at_idx" ON "gym_assisted_checkin_events"("gym_id", "created_at");
CREATE INDEX "gym_assisted_checkin_events_staff_user_id_idempotency_key_idx" ON "gym_assisted_checkin_events"("staff_user_id", "idempotency_key");
CREATE INDEX "gym_assisted_checkin_events_membership_id_created_at_idx" ON "gym_assisted_checkin_events"("membership_id", "created_at");
-- Một khoá idempotency chỉ có thể kết thúc bằng MỘT check-in thành công (chặn ở cấp DB, kể cả hai request song song).
CREATE UNIQUE INDEX "gym_assisted_checkin_events_success_key"
  ON "gym_assisted_checkin_events"("staff_user_id", "idempotency_key")
  WHERE "event_type" = 'CHECKIN_SUCCEEDED' AND "idempotency_key" IS NOT NULL;
-- Một lượt check-in chỉ gắn một sự kiện thành công.
CREATE UNIQUE INDEX "gym_assisted_checkin_events_checkin_key"
  ON "gym_assisted_checkin_events"("checkin_id") WHERE "checkin_id" IS NOT NULL AND "event_type" = 'CHECKIN_SUCCEEDED';

CREATE OR REPLACE FUNCTION gym_assisted_checkin_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'gym_assisted_checkin_events là nhật ký chỉ-thêm: không sửa/xoá (%).', TG_OP USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER gym_assisted_checkin_events_no_update BEFORE UPDATE OR DELETE ON "gym_assisted_checkin_events"
  FOR EACH ROW EXECUTE FUNCTION gym_assisted_checkin_events_append_only();
CREATE TRIGGER gym_assisted_checkin_events_no_truncate BEFORE TRUNCATE ON "gym_assisted_checkin_events"
  FOR EACH STATEMENT EXECUTE FUNCTION gym_assisted_checkin_events_append_only();

-- 4. Thử thách OTP (chỉ lưu băm).
CREATE TABLE "gym_assisted_checkin_challenges" (
    "id" TEXT NOT NULL,
    "gym_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "staff_user_id" TEXT NOT NULL,
    "otp_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL,
    "locked_at" TIMESTAMP(3),
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gym_assisted_checkin_challenges_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "gym_assisted_checkin_challenges_membership_id_created_at_idx" ON "gym_assisted_checkin_challenges"("membership_id", "created_at");
CREATE INDEX "gym_assisted_checkin_challenges_gym_id_staff_user_id_idx" ON "gym_assisted_checkin_challenges"("gym_id", "staff_user_id");

-- 5. Ngoại lệ do quản lý duyệt.
CREATE TABLE "gym_assisted_checkin_exceptions" (
    "id" TEXT NOT NULL,
    "gym_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "request_reason" TEXT NOT NULL,
    "status" "AssistedExceptionStatus" NOT NULL DEFAULT 'PENDING',
    "decided_by" TEXT,
    "decided_by_role" "PartnerAccountRole",
    "decision_reason" TEXT,
    "decided_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_checkin_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gym_assisted_checkin_exceptions_pkey" PRIMARY KEY ("id"),
    -- Bốn mắt: người quyết định không bao giờ là người xin.
    CONSTRAINT "gym_assisted_checkin_exceptions_four_eyes" CHECK ("decided_by" IS NULL OR "decided_by" <> "requested_by")
);
CREATE INDEX "gym_assisted_checkin_exceptions_gym_id_status_expires_at_idx" ON "gym_assisted_checkin_exceptions"("gym_id", "status", "expires_at");
CREATE INDEX "gym_assisted_checkin_exceptions_membership_id_status_idx" ON "gym_assisted_checkin_exceptions"("membership_id", "status");
-- Mỗi hội viên chỉ có MỘT ngoại lệ đang mở (chờ duyệt hoặc đã duyệt chưa dùng) tại một thời điểm.
CREATE UNIQUE INDEX "gym_assisted_checkin_exceptions_one_open_key"
  ON "gym_assisted_checkin_exceptions"("membership_id") WHERE "status" IN ('PENDING', 'APPROVED');
