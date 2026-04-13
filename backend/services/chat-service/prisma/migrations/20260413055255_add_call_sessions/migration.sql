-- CreateEnum
CREATE TYPE "CallType" AS ENUM ('VOICE', 'VIDEO');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('INITIATING', 'RINGING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'CONNECTING', 'ACTIVE', 'ENDED', 'MISSED', 'FAILED');

-- CreateEnum
CREATE TYPE "CallOrigin" AS ENUM ('CHAT', 'SESSION');

-- CreateTable
CREATE TABLE "call_sessions" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "callerId" TEXT NOT NULL,
    "calleeId" TEXT NOT NULL,
    "call_type" "CallType" NOT NULL,
    "status" "CallStatus" NOT NULL DEFAULT 'INITIATING',
    "origin" "CallOrigin" NOT NULL DEFAULT 'CHAT',
    "coaching_session_id" TEXT,
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "answered_at" TIMESTAMP(3),
    "end_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "call_sessions_callerId_idx" ON "call_sessions"("callerId");

-- CreateIndex
CREATE INDEX "call_sessions_calleeId_idx" ON "call_sessions"("calleeId");

-- CreateIndex
CREATE INDEX "call_sessions_conversationId_idx" ON "call_sessions"("conversationId");

-- CreateIndex
CREATE INDEX "call_sessions_status_idx" ON "call_sessions"("status");

-- AddForeignKey
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
