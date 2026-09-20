-- GYM_PARTNER_SELF_ONBOARDING_SPEC.md — đối tác Gym tự đăng ký: email → link → đặt mật khẩu.
-- Bảng mới, không chạm dữ liệu cũ. Token lưu băm (sha256), giống password_reset_tokens.

CREATE TABLE "partner_application_tokens" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "verified_at" TIMESTAMP(3),
    "used_at" TIMESTAMP(3),
    "superseded_at" TIMESTAMP(3),
    "setup_token_hash" TEXT,
    "setup_expires_at" TIMESTAMP(3),
    "created_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_application_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "partner_application_tokens_token_hash_key" ON "partner_application_tokens"("token_hash");
CREATE UNIQUE INDEX "partner_application_tokens_setup_token_hash_key" ON "partner_application_tokens"("setup_token_hash");
CREATE INDEX "partner_application_tokens_email_created_at_idx" ON "partner_application_tokens"("email", "created_at");
