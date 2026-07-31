-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "session_id" TEXT;

-- CreateTable
CREATE TABLE "chat_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_sessions_user_id_archived_at_last_message_at_idx" ON "chat_sessions"("user_id", "archived_at", "last_message_at");

-- CreateIndex
CREATE INDEX "conversations_user_id_session_id_created_at_idx" ON "conversations"("user_id", "session_id", "created_at");
