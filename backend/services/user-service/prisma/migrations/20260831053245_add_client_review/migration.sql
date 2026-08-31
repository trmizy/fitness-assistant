-- CreateTable
CREATE TABLE "client_reviews" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "pt_user_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_reviews_session_id_key" ON "client_reviews"("session_id");

-- CreateIndex
CREATE INDEX "client_reviews_contract_id_idx" ON "client_reviews"("contract_id");

-- AddForeignKey
ALTER TABLE "client_reviews" ADD CONSTRAINT "client_reviews_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_reviews" ADD CONSTRAINT "client_reviews_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
