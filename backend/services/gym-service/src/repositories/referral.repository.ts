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
};
