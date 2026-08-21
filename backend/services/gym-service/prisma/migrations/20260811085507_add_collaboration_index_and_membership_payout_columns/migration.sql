-- AlterTable
ALTER TABLE "gym_membership_contracts" ADD COLUMN     "multi_gym_warned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "payout_released_at" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "gym_membership_referrals" ADD CONSTRAINT "gym_membership_referrals_membership_contract_id_fkey" FOREIGN KEY ("membership_contract_id") REFERENCES "gym_membership_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Only one ACCEPTED collaboration may exist per (gym, PT) pair at a time. The app layer
-- already checks this before creating a row, but a partial unique index makes the database
-- the final backstop against a race the app check cannot fully close (§1.1 of the plan).
CREATE UNIQUE INDEX "gym_pt_collaborations_accepted_pair_key"
  ON "gym_pt_collaborations" ("gym_id", "pt_user_id")
  WHERE "status" = 'ACCEPTED';
