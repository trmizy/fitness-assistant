-- CreateTable
CREATE TABLE "ai_generation_operations" (
    "id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "subject_user_id" TEXT,
    "kind" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RESERVING',
    "target_type" TEXT,
    "target_id" TEXT,
    "payload" JSONB,
    "message_id" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "last_error" TEXT,
    "published_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_generation_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_generation_operations_status_updated_at_idx" ON "ai_generation_operations"("status", "updated_at");

-- CreateIndex
CREATE INDEX "ai_generation_operations_target_type_target_id_idx" ON "ai_generation_operations"("target_type", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_generation_operations_actor_user_id_idempotency_key_key" ON "ai_generation_operations"("actor_user_id", "idempotency_key");

