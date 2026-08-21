-- Audit trail for user-service (Phase 1 "record important status changes" and
-- Phase 2 "record session schedule changes").
--
-- auth-service already had an audit_logs table; user-service never did, so the two
-- logging requirements had nowhere to write. This adds the table with a deliberate
-- difference: no foreign key to user_profiles. auth-service cascades its log from User,
-- which is right for login history and wrong here — deleting a profile would destroy the
-- evidence a dispute about that profile depends on.

-- CreateEnum
CREATE TYPE "AuditEntityType" AS ENUM ('CONTRACT', 'SESSION', 'SERVICE_PACKAGE', 'PT_PROFILE');

-- CreateTable
CREATE TABLE "audit_logs" (
    "id"            TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "action"        TEXT NOT NULL,
    "entity_type"   "AuditEntityType" NOT NULL,
    "entity_id"     TEXT NOT NULL,
    "metadata"      JSONB,
    "ip_address"    TEXT,
    "user_agent"    TEXT,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: reading the history of one contract or session is the query this table exists for.
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx"
    ON "audit_logs"("entity_type", "entity_id", "created_at");

-- CreateIndex: "everything this actor did" — used when investigating one party's conduct.
CREATE INDEX "audit_logs_actor_user_id_created_at_idx"
    ON "audit_logs"("actor_user_id", "created_at");
