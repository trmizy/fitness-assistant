-- CreateEnum
CREATE TYPE "CollaborationStatus" AS ENUM ('PENDING', 'COUNTERED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "CollaborationParty" AS ENUM ('PT', 'GYM');

-- CreateTable
CREATE TABLE "gym_pt_collaborations" (
    "id" TEXT NOT NULL,
    "gym_id" TEXT NOT NULL,
    "pt_user_id" TEXT NOT NULL,
    "proposed_pt_rate" DECIMAL(6,4) NOT NULL,
    "proposed_gym_rate" DECIMAL(6,4) NOT NULL,
    "platform_rate" DECIMAL(6,4) NOT NULL DEFAULT 0.10,
    "status" "CollaborationStatus" NOT NULL DEFAULT 'PENDING',
    "proposed_by" "CollaborationParty" NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "terminated_at" TIMESTAMP(3),
    "terminated_by" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gym_pt_collaborations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gym_membership_referrals" (
    "id" TEXT NOT NULL,
    "membership_contract_id" TEXT NOT NULL,
    "gym_id" TEXT NOT NULL,
    "referrer_pt_user_id" TEXT NOT NULL,
    "rate" DECIMAL(6,4) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "clawed_back" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gym_membership_referrals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gym_pt_collaborations_gym_id_status_idx" ON "gym_pt_collaborations"("gym_id", "status");

-- CreateIndex
CREATE INDEX "gym_pt_collaborations_pt_user_id_status_idx" ON "gym_pt_collaborations"("pt_user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "gym_membership_referrals_membership_contract_id_key" ON "gym_membership_referrals"("membership_contract_id");

-- CreateIndex
CREATE INDEX "gym_membership_referrals_referrer_pt_user_id_status_idx" ON "gym_membership_referrals"("referrer_pt_user_id", "status");

-- CreateIndex
CREATE INDEX "gym_membership_referrals_gym_id_idx" ON "gym_membership_referrals"("gym_id");

-- AddForeignKey
ALTER TABLE "gym_pt_collaborations" ADD CONSTRAINT "gym_pt_collaborations_gym_id_fkey" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
