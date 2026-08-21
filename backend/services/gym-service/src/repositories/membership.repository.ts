import { Prisma } from '../generated/prisma';
import { prisma } from './prisma';

export const membershipRepository = {
  async create(data: Prisma.GymMembershipContractCreateInput) {
    return prisma.gymMembershipContract.create({ data });
  },

  async findById(id: string) {
    return prisma.gymMembershipContract.findUnique({ where: { id } });
  },

  /** Includes the referral row, when this membership was bought with a referral code. */
  async findByIdWithReferral(id: string) {
    return prisma.gymMembershipContract.findUnique({ where: { id }, include: { referral: true } });
  },

  /**
   * A membership another purchase's uniqueness check must know about, even if it has since
   * ended — used to enforce "referral codes only apply to a client's FIRST membership at a
   * gym" (money-flow plan §2.5/A2), which cancelled/expired history still counts against.
   */
  async hasEverHadMembershipAt(clientId: string, gymId: string): Promise<boolean> {
    const count = await prisma.gymMembershipContract.count({ where: { clientId, gymId } });
    return count > 0;
  },

  /**
   * Every OTHER gym where this client currently holds an ACTIVE membership (A4 warning).
   * `endDate > now` guards against a row that is ACTIVE in the database but has actually
   * lapsed and simply hasn't been lazily expired by a read yet (the same pattern
   * `expireIfPastEndDate` exists to fix) — that row must not trigger a false warning.
   */
  async findOtherActiveMemberships(clientId: string, excludingGymId: string) {
    return prisma.gymMembershipContract.findMany({
      where: { clientId, status: 'ACTIVE', gymId: { not: excludingGymId }, endDate: { gt: new Date() } },
      include: { gym: { select: { name: true } } },
    });
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

  /**
   * Client cancels their own ACTIVE membership — no refund (money-flow plan §2.4). Guarded
   * `updateMany` on the current status so a double-submit only flips the row once; the caller
   * only proceeds to release money when `affected === 1`.
   */
  async cancelByClient(id: string): Promise<{ affected: number; contract: any }> {
    const { count } = await prisma.gymMembershipContract.updateMany({
      where: { id, status: 'ACTIVE' },
      data: { status: 'CANCELLED' },
    });
    const contract = await prisma.gymMembershipContract.findUnique({ where: { id } });
    return { affected: count, contract };
  },

  /** Stamped once the pending-bucket payout has been released — guards against double-release. */
  async markPayoutReleased(id: string) {
    return prisma.gymMembershipContract.update({ where: { id }, data: { payoutReleasedAt: new Date() } });
  },

  /**
   * ACTIVE memberships past their endDate that nobody has read since (so the usual
   * read-time lazy-expire in `expireIfPastEndDate` never ran). The payout sweep must expire
   * these itself — otherwise a membership nobody happens to look at keeps its payout stuck
   * in pending forever, exactly the "money kẹt vĩnh viễn" failure mode the sweep exists to
   * prevent.
   */
  async expirePastEndDateBatch(limit: number): Promise<number> {
    const due = await prisma.gymMembershipContract.findMany({
      where: { status: 'ACTIVE', endDate: { lt: new Date() } },
      take: limit,
      select: { id: true },
    });
    if (due.length === 0) return 0;
    const { count } = await prisma.gymMembershipContract.updateMany({
      where: { id: { in: due.map((d) => d.id) }, status: 'ACTIVE' },
      data: { status: 'EXPIRED' },
    });
    return count;
  },

  /** EXPIRED memberships whose gym/platform/referral payout has not yet been released. */
  async findExpiredNotReleased(limit: number) {
    return prisma.gymMembershipContract.findMany({
      where: { status: 'EXPIRED', payoutReleasedAt: null, paymentTxnId: { not: null } },
      include: { referral: true },
      take: limit,
      orderBy: { endDate: 'asc' },
    });
  },
};
