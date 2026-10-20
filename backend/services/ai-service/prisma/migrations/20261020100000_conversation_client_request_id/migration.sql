-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "client_request_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "conversations_user_id_client_request_id_key" ON "conversations"("user_id", "client_request_id");
