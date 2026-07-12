import { Prisma } from '../generated/prisma';
import { prisma } from './prisma';

export const membershipRepository = {
  async create(data: Prisma.GymMembershipContractCreateInput) {
    return prisma.gymMembershipContract.create({ data });
  },

  async findById(id: string) {
    return prisma.gymMembershipContract.findUnique({ where: { id } });
  },

  async findByClient(clientId: string) {
    return prisma.gymMembershipContract.findMany({ where: { clientId }, orderBy: { createdAt: 'desc' } });
  },

  async findByGym(gymId: string) {
    return prisma.gymMembershipContract.findMany({ where: { gymId }, orderBy: { createdAt: 'desc' } });
  },

  /** Open = PENDING_PAYMENT or ACTIVE (matches the partial unique index). */
  async findOpenByClientAndGym(clientId: string, gymId: string) {
    return prisma.gymMembershipContract.findFirst({
      where: { clientId, gymId, status: { in: ['PENDING_PAYMENT', 'ACTIVE'] } },
    });
  },

  /** Lazy expiration: if this row is ACTIVE but past endDate, flip it to EXPIRED first. */
  async expireIfPastEndDate(contract: { id: string; status: string; endDate: Date | null }) {
    if (contract.status === 'ACTIVE' && contract.endDate && contract.endDate < new Date()) {
      return prisma.gymMembershipContract.update({ where: { id: contract.id }, data: { status: 'EXPIRED' } });
    }
    return null;
  },

  /** Idempotent activation: only flips PENDING_PAYMENT -> ACTIVE; a repeat call is a no-op. */
  async activateIfPending(id: string, paymentTxnId: string) {
    const contract = await prisma.gymMembershipContract.findUnique({ where: { id } });
    if (!contract) return { affected: 0, contract: null };
    if (contract.status === 'ACTIVE') return { affected: 0, contract }; // already done — no-op
    if (contract.status !== 'PENDING_PAYMENT') return { affected: 0, contract };

    const endDate = new Date(Date.now() + contract.durationDaysSnapshot * 24 * 60 * 60 * 1000);
    const updated = await prisma.gymMembershipContract.update({
      where: { id },
      data: { status: 'ACTIVE', startDate: new Date(), endDate, paymentTxnId },
    });
    return { affected: 1, contract: updated };
  },

  async cancelIfPending(id: string) {
    const contract = await prisma.gymMembershipContract.findUnique({ where: { id } });
    if (!contract) return null;
    if (contract.status !== 'PENDING_PAYMENT') return contract;
    return prisma.gymMembershipContract.update({ where: { id }, data: { status: 'CANCELLED' } });
  },

  /** Idempotent: only cancels an ACTIVE membership (a repeat call after it's already CANCELLED is a no-op). */
  async cancelAfterRefund(id: string) {
    const contract = await prisma.gymMembershipContract.findUnique({ where: { id } });
    if (!contract) return null;
    if (contract.status === 'CANCELLED') return contract; // already done — no-op
    return prisma.gymMembershipContract.update({ where: { id }, data: { status: 'CANCELLED' } });
  },
};
