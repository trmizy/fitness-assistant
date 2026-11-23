import { Prisma, GymMembershipContractStatus } from '../generated/prisma';
import { prisma } from './prisma';
import { stackedPeriod } from '../services/membership-stacking';

export const membershipRepository = {
  async create(data: Prisma.GymMembershipContractCreateInput) {
    return prisma.gymMembershipContract.create({ data });
  },

  async findById(id: string) {
    return prisma.gymMembershipContract.findUnique({ where: { id } });
  },

  async findByIdWithGymName(id: string) {
    return prisma.gymMembershipContract.findUnique({
      where: { id },
      include: { gym: { select: { name: true, approvedName: true } } },
    });
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
    // Money-flow plan 3.8 / P0 cluster E3: checks paymentTxnId, not the current status.
    // Checking `status !== 'PENDING_PAYMENT'` used to miss that a never-paid order does not
    // STAY PENDING_PAYMENT forever — cancelIfPending (the client's own explicit cancel) and
    // the pending-payment-expiry sweep (P0 E3) both move an order that was NEVER actually
    // paid for into CANCELLED, the exact status this query already (correctly) treats as "a
    // real purchase" for a genuinely-activated-then-cancelled membership. paymentTxnId is
    // only ever set by activateIfPending — a real, confirmed payment — so it stays a reliable
    // signal regardless of what status a never-paid order eventually lands in.
    const count = await prisma.gymMembershipContract.count({
      where: { clientId, gymId, paymentTxnId: { not: null } },
    });
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
      include: { gym: { select: { name: true, approvedName: true } } },
    });
  },

  async findByClient(clientId: string) {
    return prisma.gymMembershipContract.findMany({
      where: { clientId },
      include: { gym: { select: { name: true, approvedName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  },

  async findByGym(gymId: string) {
    return prisma.gymMembershipContract.findMany({ where: { gymId }, orderBy: { createdAt: 'desc' } });
  },

  /**
   * One page of a branch's memberships, newest first (keyset on createdAt + id - stable while rows are inserted, and it
   * uses the gym_id index). Fetches `limit + 1` rows so the caller knows whether another page exists without a COUNT.
   * `cursor` is the `{createdAt, id}` of the LAST row of the previous page.
   * `expiringBefore` keeps memberships whose endDate is still in the future (> now) and <= the given instant - "about to
   * expire"; it is meant to be combined with status=ACTIVE.
   */
  async pageForGym(
    gymId: string,
    opts: {
      /** null = no paging, return every matching row (the pre-pagination behaviour). */
      limit: number | null;
      cursor?: { createdAt: Date; id: string } | null;
      status?: Prisma.GymMembershipContractWhereInput['status'];
      expiringBefore?: Date | null;
      /** Member search: keep only these clients (already matched by name). Undefined = no restriction (the normal list). */
      clientIds?: readonly string[];
    },
    now: Date = new Date(),
  ) {
    const and: Prisma.GymMembershipContractWhereInput[] = [];
    if (opts.cursor) {
      and.push({ OR: [{ createdAt: { lt: opts.cursor.createdAt } }, { createdAt: opts.cursor.createdAt, id: { lt: opts.cursor.id } }] });
    }
    if (opts.expiringBefore) and.push({ endDate: { gt: now, lte: opts.expiringBefore } });
    return prisma.gymMembershipContract.findMany({
      where: {
        gymId,
        ...(opts.status ? { status: opts.status } : {}),
        ...(opts.clientIds ? { clientId: { in: [...opts.clientIds] } } : {}),
        ...(and.length ? { AND: and } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(opts.limit !== null ? { take: opts.limit + 1 } : {}),
    });
  },

  /**
   * Member search step 1: the DISTINCT client ids of one branch's memberships (ids only - no row is loaded), honouring the same status /
   * expiringBefore filters as pageForGym. Not cursor-bound: the candidate set is the same on every page of a walk. `take: max + 1` (GROUP BY in the
   * DB) lets the caller see that the branch has more distinct clients than it is willing to send for name matching.
   */
  async distinctClientIdsForGym(
    gymId: string,
    opts: { status?: Prisma.GymMembershipContractWhereInput['status']; expiringBefore?: Date | null; max: number },
    now: Date = new Date(),
  ): Promise<string[]> {
    const rows = await prisma.gymMembershipContract.groupBy({
      by: ['clientId'],
      where: {
        gymId,
        ...(opts.status ? { status: opts.status } : {}),
        ...(opts.expiringBefore ? { endDate: { gt: now, lte: opts.expiringBefore } } : {}),
      },
      orderBy: { clientId: 'asc' },
      take: opts.max + 1,
    });
    return rows.map((r) => r.clientId);
  },

  /**
   * Counts for the owner dashboard, computed by the DB. REAL rows only (same rule as countActiveByGyms).
   * `active` = a membership that is running right now (ACTIVE, not past endDate, already started - a queued renewal is not
   * a current member); `expiringSoon` = those of them whose endDate falls within `soonUntil`; `byStatus` = raw status counts.
   */
  async statsForGym(gymId: string, now: Date, soonUntil: Date) {
    const running: Prisma.GymMembershipContractWhereInput = {
      gymId,
      status: 'ACTIVE',
      dataOrigin: 'REAL',
      endDate: { gt: now },
      OR: [{ startDate: null }, { startDate: { lte: now } }],
    };
    const [active, expiringSoon, grouped] = await Promise.all([
      prisma.gymMembershipContract.count({ where: running }),
      prisma.gymMembershipContract.count({ where: { ...running, endDate: { gt: now, lte: soonUntil } } }),
      prisma.gymMembershipContract.groupBy({ by: ['status'], where: { gymId, dataOrigin: 'REAL' }, _count: true }),
    ]);
    const byStatus: Record<string, number> = Object.fromEntries(Object.values(GymMembershipContractStatus).map((v) => [v, 0]));
    for (const g of grouped) byStatus[g.status] = g._count;
    return { active, expiringSoon, byStatus };
  },

  /** Phase 5 — mọi hội viên REAL đang ACTIVE trên NHIỀU chi nhánh cùng lúc, cho màn xác nhận
   * "Chấm dứt hợp tác" đếm số người + tổng giá trị chưa dùng across cả đối tác. */
  async findActiveByGyms(gymIds: string[]) {
    if (gymIds.length === 0) return [];
    return prisma.gymMembershipContract.findMany({ where: { gymId: { in: gymIds }, status: 'ACTIVE', dataOrigin: 'REAL' } });
  },

  /**
   * GYM_MANAGEMENT master spec, Phase 5 (Complaints) — eligibility guard for "Báo cáo vấn
   * đề": only a client with a REAL membership at this gym that's currently ACTIVE, or EXPIRED
   * within the last `withinDays` days, may report an issue about it. Deliberately stricter
   * than the review system's "ever paid, any time" rule (reviewService.submit) — a report
   * is meant to be timely, not a channel for airing an arbitrarily old grievance.
   */
  async hasRecentOrActiveMembership(clientId: string, gymId: string, withinDays: number, dataOrigin: 'REAL' | 'SYNTHETIC' = 'REAL'): Promise<boolean> {
    const cutoff = new Date(Date.now() - withinDays * 24 * 60 * 60 * 1000);
    const count = await prisma.gymMembershipContract.count({
      where: {
        clientId,
        gymId,
        dataOrigin,
        OR: [{ status: 'ACTIVE' }, { status: 'EXPIRED', endDate: { gte: cutoff } }],
      },
    });
    return count > 0;
  },

  /** Open = PENDING_PAYMENT or ACTIVE (matches the partial unique index). */
  async findOpenByClientAndGym(clientId: string, gymId: string) {
    return prisma.gymMembershipContract.findFirst({
      where: { clientId, gymId, status: { in: ['PENDING_PAYMENT', 'ACTIVE'] } },
    });
  },

  /** An unpaid order of this client at this gym - the only thing that still blocks a new purchase (stacking allows paid ones to queue). */
  async findPendingByClientAndGym(clientId: string, gymId: string) {
    return prisma.gymMembershipContract.findFirst({ where: { clientId, gymId, status: 'PENDING_PAYMENT' } });
  },

  /** End of the client's latest still-running paid membership of a brand (current or queued) - where a renewal would start. Null = none. */
  async latestActiveEndForBrand(clientId: string, brandId: string, now: Date = new Date()): Promise<Date | null> {
    const r = await prisma.gymMembershipContract.aggregate({
      where: { clientId, status: 'ACTIVE', plan: { brandId }, endDate: { gt: now } },
      _max: { endDate: true },
    });
    return r._max.endDate ?? null;
  },

  /**
   * How many currently-ACTIVE REAL members each gym has — same groupBy shape as
   * `reviewRepository.aggregateForGyms`, used for the owner's "Phòng gym của tôi" dashboard.
   * `endDate > now` mirrors `findOtherActiveMemberships`'s guard: a row can be ACTIVE in the
   * database but already past its own endDate if nothing has lazily expired it yet.
   */
  async countActiveByGyms(gymIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (gymIds.length === 0) return map;
    const rows = await prisma.gymMembershipContract.groupBy({
      by: ['gymId'],
      // A stacked renewal that has not begun (startDate in the future) is not a current member yet.
      where: { gymId: { in: gymIds }, status: 'ACTIVE', dataOrigin: 'REAL', endDate: { gt: new Date() }, OR: [{ startDate: null }, { startDate: { lte: new Date() } }] },
      _count: true,
    });
    for (const r of rows) map.set(r.gymId, r._count);
    return map;
  },

  /** Lazy expiration: if this row is ACTIVE but past endDate, flip it to EXPIRED first. */
  async expireIfPastEndDate(contract: { id: string; status: string; endDate: Date | null }) {
    if (contract.status === 'ACTIVE' && contract.endDate && contract.endDate < new Date()) {
      return prisma.gymMembershipContract.update({ where: { id: contract.id }, data: { status: 'EXPIRED' } });
    }
    return null;
  },

  /**
   * Idempotent activation: only flips PENDING_PAYMENT -> ACTIVE; a repeat call is a no-op.
   * FH-5: the flip is a CONDITIONAL write (where status is still PENDING_PAYMENT), the same guard cancelIfPending uses,
   * so a concurrent client cancel and this activation can never both "win": `affected` is 1 only for the call that
   * really made the transition, and the caller must treat affected 0 + a row that is not ACTIVE-by-this-payment as
   * "not activatable" (payment-service then refunds), never as success.
   */
  async activateIfPending(id: string, paymentTxnId: string) {
    const contract = await prisma.gymMembershipContract.findUnique({ where: { id }, include: { plan: { select: { brandId: true } } } });
    if (!contract) return { affected: 0, contract: null };
    if (contract.status !== 'PENDING_PAYMENT') return { affected: 0, contract }; // already done / not payable — no-op

    // Stacked renewal ("Gia hạn"): the period starts when the client's latest paid membership of the SAME BRAND ends
    // (a membership is valid brand-wide), else now. Computed here, at the moment the payment lands, and under a
    // per-(client, brand) advisory lock, so two activations can never both read the same "latest end" and overlap.
    // Money is untouched: the price is already in escrow / pending; the payout sweep keys on THIS row's own endDate.
    const flipped = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`gym-membership-stack:${contract.clientId}:${contract.plan.brandId}`}))`;
        const now = new Date();
        const latest = await tx.gymMembershipContract.aggregate({
          where: { clientId: contract.clientId, id: { not: id }, status: 'ACTIVE', plan: { brandId: contract.plan.brandId }, endDate: { gt: now } },
          _max: { endDate: true },
        });
        const { startDate, endDate } = stackedPeriod(now, latest._max.endDate, contract.durationDaysSnapshot);
        return tx.gymMembershipContract.updateMany({
          where: { id, status: 'PENDING_PAYMENT' },
          data: { status: 'ACTIVE', startDate, endDate, paymentTxnId },
        });
      },
      { timeout: 15_000, maxWait: 10_000 },
    );
    return { affected: flipped.count, contract: await prisma.gymMembershipContract.findUnique({ where: { id } }) };
  },

  /** Cancels an unpaid membership - conditional write (FH-5); a row that is no longer PENDING_PAYMENT is returned untouched. */
  async cancelIfPending(id: string) {
    await prisma.gymMembershipContract.updateMany({ where: { id, status: 'PENDING_PAYMENT' }, data: { status: 'CANCELLED' } });
    return prisma.gymMembershipContract.findUnique({ where: { id } });
  },

  /** P0 cluster E2 — idempotent: only flips PENDING_PAYMENT -> PENDING_ISSUE. A membership
   * already PENDING_ISSUE (a retried webhook) or that moved on some other way returns as-is
   * so the caller can tell whether IT was the one that just made the transition. Records
   * paymentTxnId here (normally only set on real activation) so a later admin-triggered
   * manual resolution has the transaction id to refund without needing it passed in again.
   * Conditional write (FH-5), like activateIfPending. */
  async markPendingIssueIfPending(id: string, paymentTxnId: string) {
    const flipped = await prisma.gymMembershipContract.updateMany({
      where: { id, status: 'PENDING_PAYMENT' },
      data: { status: 'PENDING_ISSUE', paymentTxnId },
    });
    return { affected: flipped.count, contract: await prisma.gymMembershipContract.findUnique({ where: { id } }) };
  },

  /** The admin queue P0 cluster E2 leaves behind when an auto-refund itself failed. */
  async listPendingIssues() {
    return prisma.gymMembershipContract.findMany({
      where: { status: 'PENDING_ISSUE' },
      orderBy: { createdAt: 'asc' },
      include: { gym: { select: { name: true, status: true } } },
    });
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

  /** Money-flow plan 1.7: guards refundByAdmin's referral-clawback step against re-applying
   * its local `clawedBack` increment on a retry after a later step failed. */
  async markClawbackDone(id: string) {
    return prisma.gymMembershipContract.update({ where: { id }, data: { refundClawbackDone: true } });
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
      where: { status: 'ACTIVE', dataOrigin: 'REAL', endDate: { lt: new Date() } },
      take: limit,
      select: { id: true },
    });
    if (due.length === 0) return 0;
    const { count } = await prisma.gymMembershipContract.updateMany({
      where: { id: { in: due.map((d) => d.id) }, status: 'ACTIVE', dataOrigin: 'REAL' },
      data: { status: 'EXPIRED' },
    });
    return count;
  },

  /** P0 cluster E3 — PENDING_PAYMENT orders nobody ever paid for and nobody explicitly
   * cancelled either, older than the given cutoff. */
  async findStalePendingPayments(cutoff: Date, limit: number) {
    return prisma.gymMembershipContract.findMany({
      where: { status: 'PENDING_PAYMENT', dataOrigin: 'REAL', createdAt: { lt: cutoff } },
      take: limit,
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
  },

  /** EXPIRED memberships whose gym/platform/referral payout has not yet been released. */
  /** `excludeIds`: memberships a Gym Case holds (B1) - excluded in the query so a held row never starves the batch. */
  async findExpiredNotReleased(limit: number, excludeIds: string[] = []) {
    return prisma.gymMembershipContract.findMany({
      where: { status: 'EXPIRED', dataOrigin: 'REAL', payoutReleasedAt: null, paymentTxnId: { not: null }, ...(excludeIds.length ? { id: { notIn: excludeIds } } : {}) },
      include: { referral: true },
      take: limit,
      orderBy: { endDate: 'asc' },
    });
  },
};
