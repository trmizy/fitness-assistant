-- Money-flow redesign plan 1.7: marks that refundByAdmin's referral-clawback local bookkeeping
-- already ran for this membership, so a retry after a later step failed does not re-apply it.
ALTER TABLE "gym_membership_contracts" ADD COLUMN "refund_clawback_done" BOOLEAN NOT NULL DEFAULT false;
