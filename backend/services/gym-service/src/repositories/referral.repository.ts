import { Prisma } from '../generated/prisma';
import { prisma } from './prisma';

export const referralRepository = {
  async create(data: { membershipContractId: string; gymId: string; referrerPtUserId: string; rate: number; amount: Prisma.Decimal }) {
    return prisma.gymMembershipReferral.create({ data });
  },

  /** Accumulates `clawedBack`; called after payment-service confirms a reclaim actually moved. */
  async recordClawback(membershipContractId: string, recoveredAmount: string) {
    return prisma.gymMembershipReferral.update({
      where: { membershipContractId },
      data: { clawedBack: { increment: recoveredAmount } },
    });
  },

  async markReleased(membershipContractId: string) {
    return prisma.gymMembershipReferral.update({
      where: { membershipContractId },
      data: { status: 'RELEASED', releasedAt: new Date() },
    });
  },

  /** P0 cluster E4 — settleReferral failed after the membership itself already activated.
   * Distinct from PENDING (never attempted) so referral-settlement-sweep.service.ts can find
   * exactly the rows that need a retry, not every still-genuinely-unsettled one. */
  async markFailed(membershipContractId: string) {
    return prisma.gymMembershipReferral.update({
      where: { membershipContractId },
      data: { status: 'FAILED' },
    });
  },

  /** The set referral-settlement-sweep.service.ts retries every tick. */
  async listFailed() {
    return prisma.gymMembershipReferral.findMany({
      where: { status: 'FAILED' },
      include: { membershipContract: { select: { id: true, paymentTxnId: true, status: true } } },
    });
  },

  /** P0 cluster E2 — the membership never activated, so settleReferral never ran and no
   * commission ever moved to the referring PT. Voids the PENDING row so it does not sit
   * looking unresolved forever (nothing will ever act on it either way — there is no sweep
   * that retro-settles a PENDING referral, this is bookkeeping hygiene, not a money move). */
  async markVoided(membershipContractId: string) {
    return prisma.gymMembershipReferral.update({
      where: { membershipContractId },
      data: { status: 'VOIDED' },
    });
  },
};
