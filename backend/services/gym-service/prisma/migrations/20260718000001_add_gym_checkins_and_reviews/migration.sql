-- CreateTable: gym_check_ins
CREATE TABLE "gym_check_ins" (
    "id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "gym_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "checked_in_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gym_check_ins_pkey" PRIMARY KEY ("id")
);

-- CreateTable: gym_reviews
CREATE TABLE "gym_reviews" (
    "id" TEXT NOT NULL,
    "gym_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gym_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gym_check_ins_gym_id_created_at_idx" ON "gym_check_ins"("gym_id", "created_at");

-- CreateIndex
CREATE INDEX "gym_check_ins_membership_id_created_at_idx" ON "gym_check_ins"("membership_id", "created_at");

-- CreateIndex
CREATE INDEX "gym_reviews_gym_id_idx" ON "gym_reviews"("gym_id");

-- CreateIndex
CREATE UNIQUE INDEX "gym_reviews_gym_id_client_id_key" ON "gym_reviews"("gym_id", "client_id");

-- AddForeignKey
ALTER TABLE "gym_check_ins" ADD CONSTRAINT "gym_check_ins_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "gym_membership_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gym_reviews" ADD CONSTRAINT "gym_reviews_gym_id_fkey" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
