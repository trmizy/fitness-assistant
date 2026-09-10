-- Phase 2 mục 2.4 — nhật ký kiểm toán bắt buộc cho hành động quản trị lên hồ sơ đối tác.

CREATE TYPE "PartnerAuditAction" AS ENUM (
    'PARTNER_CREATED',
    'PARTNER_UPDATED',
    'ACCOUNT_PROVISIONED',
    'INVITATION_RESENT',
    'INVITATION_REVOKED',
    'PASSWORD_RESET_SENT',
    'SESSIONS_REVOKED',
    'ACCOUNT_REVOKED',
    'OWNERSHIP_TRANSFERRED',
    'PARTNER_SUSPENDED',
    'PARTNER_UNSUSPENDED',
    'PARTNER_TERMINATED',
    'VIEWED_AS_PARTNER'
);

CREATE TABLE "partner_audit_logs" (
    "id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "action" "PartnerAuditAction" NOT NULL,
    "target_account_id" TEXT,
    "reason" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "partner_audit_logs_partner_id_created_at_idx" ON "partner_audit_logs"("partner_id", "created_at");
CREATE INDEX "partner_audit_logs_actor_user_id_idx" ON "partner_audit_logs"("actor_user_id");

ALTER TABLE "partner_audit_logs" ADD CONSTRAINT "partner_audit_logs_partner_id_fkey"
    FOREIGN KEY ("partner_id") REFERENCES "gym_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
