-- CreateTable
CREATE TABLE "ledger_operations" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ledger_operations_key_key" ON "ledger_operations"("key");
