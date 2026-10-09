import { ContractStatus, ContractSource, PackageType, SessionMode, SessionStatus, Prisma } from "../generated/prisma";
import { prisma } from "./profile.repository";

/** Vòng 4 / Phase A3 — same reasoning as session.repository.ts's own Db type: findById needs
 *  to run on whichever connection currently holds withPtScheduleLock's advisory lock, so a
 *  caller reading the contract INSIDE that lock sees a truly fresh row (not one read before
 *  the lock was ever acquired). Defaults to the singleton client everywhere else. */
type Db = typeof prisma | Prisma.TransactionClient;

export const contractRepository = {
  create: (data: {
    agentActionId?: string;
    ptUserId: string;
    clientUserId: string;
    status?: ContractStatus;
    source?: ContractSource;
    packageType?: PackageType;
    packageName: string;
    description?: string;
    packageQuantity?: number;
    extraSessions?: number;
    totalSessions: number;
    price?: number;
    pricePerSession?: number;
    sessionMode?: SessionMode;
    startDate?: Date;
    endDate?: Date;
    clientMessage?: string;
    terms?: string;
    notes?: string;
    // Revenue split, frozen at signing (money-flow plan §1.4) — see docs/money-flow.md §12
    // for why this is a snapshot rather than a lookup. Omitted → schema defaults
    // (0.10/0.90/0, source INDEPENDENT) apply, which is correct for a PT hired directly.
    gymId?: string;
    platformRate?: Prisma.Decimal | string;
    ptRate?: Prisma.Decimal | string;
    gymRate?: Prisma.Decimal | string;
    // PT holdback rate, snapshotted at creation (see pt-holdback-rate.ts). Omitted → schema default 0.
    ptHoldbackRate?: Prisma.Decimal | string;
    paymentTransactionId?: string;
  }) => prisma.contract.create({ data }),

  findById: (id: string, db: Db = prisma) => db.contract.findUnique({ where: { id } }),

  findByIdWithSessions: (id: string) =>
    prisma.contract.findUnique({
      where: { id },
      include: {
        sessions: { orderBy: { scheduledStartAt: "asc" } },
        reviews: true,
      },
    }),

  findByPT: (ptUserId: string, status?: ContractStatus) =>
    prisma.contract.findMany({
      where: { ptUserId, ...(status && { status }) },
      orderBy: { createdAt: "desc" },
    }),

  /** Phase 6 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — strict,
   * direction-specific (PT -> client, not either direction) ACTIVE-only
   * check, deliberately narrower than findActiveByPair/findRelationshipByPair
   * above (which also match PENDING_SIGNATURE/COMPLETED/etc.) — every new
   * PT client-data/plan-assignment endpoint must re-check this exact
   * condition per request, never cache it. */
  findActivePtClientPair: (ptUserId: string, clientUserId: string) =>
    prisma.contract.findFirst({
      where: { ptUserId, clientUserId, status: ContractStatus.ACTIVE },
      select: { id: true },
    }),

  findByClient: (clientUserId: string, status?: ContractStatus) =>
    prisma.contract.findMany({
      where: { clientUserId, ...(status && { status }) },
      orderBy: { createdAt: "desc" },
    }),

  /** Find any ACTIVE or PENDING_REVIEW contract for a client (across all PTs) */
  findActiveOrPendingByClient: (clientUserId: string) =>
    prisma.contract.findFirst({
      where: {
        clientUserId,
        status: { in: [ContractStatus.ACTIVE, ContractStatus.PENDING_REVIEW] },
      },
    }),

  /** Find active/pending contract between specific PT and client (BR-27) */
  findActiveByPair: (ptUserId: string, clientUserId: string) =>
    prisma.contract.findFirst({
      where: {
        ptUserId,
        clientUserId,
        status: {
          in: [
            ContractStatus.PENDING_REVIEW,
            ContractStatus.PENDING_SIGNATURE,
            ContractStatus.ACTIVE,
          ],
        },
      },
    }),

  /** Find ACTIVE or COMPLETED contract between PT and client (BR-32) */
  findActiveOrCompletedByPair: (ptUserId: string, clientUserId: string) =>
    prisma.contract.findFirst({
      where: {
        ptUserId,
        clientUserId,
        status: { in: [ContractStatus.ACTIVE, ContractStatus.COMPLETED] },
      },
    }),

  /** Check if any PT-Client contract relationship exists between two users in either direction (BR-29) */
  findRelationshipByPair: (userAId: string, userBId: string) =>
    prisma.contract.findFirst({
      where: {
        OR: [
          { ptUserId: userAId, clientUserId: userBId },
          { ptUserId: userBId, clientUserId: userAId },
        ],
        status: {
          in: [
            ContractStatus.ACTIVE,
            ContractStatus.PENDING_SIGNATURE,
            ContractStatus.COMPLETED,
          ],
        },
      },
    }),

  updateStatus: (
    id: string,
    status: ContractStatus,
    extra?: Record<string, any>,
  ) =>
    prisma.contract.update({
      where: { id },
      data: { status, ...extra },
    }),

  update: (id: string, data: Record<string, any>) =>
    prisma.contract.update({ where: { id }, data }),

  incrementSession: (id: string) =>
    prisma.contract.update({
      where: { id },
      data: { usedSessions: { increment: 1 } },
    }),

  /** Money-flow plan 1.5: a PT no-show consumes one entitlement WITHOUT touching
   * totalSessions (immutable once signed) or usedSessions (reserved for sessions the client
   * actually trained, or was charged for by cancelling late). */
  incrementCompensatedSessions: (id: string, notes?: string) =>
    prisma.contract.update({
      where: { id },
      data: { compensatedSessions: { increment: 1 }, ...(notes !== undefined && { notes }) },
    }),

  /** Find all expired active contracts */
  findExpiredContracts: () =>
    prisma.contract.findMany({
      where: {
        status: ContractStatus.ACTIVE,
        endDate: { lt: new Date() },
      },
    }),

  /** PENDING_PAYMENT contracts whose payment deadline has passed (candidates for the sweep). */
  findOverduePendingPayment: (now: Date) =>
    prisma.contract.findMany({
      where: {
        status: ContractStatus.PENDING_PAYMENT,
        paymentTransactionId: null,
        paymentDueAt: { lte: now },
      },
    }),

  /**
   * Guarded cancel: ONE UPDATE ... WHERE, so it only lands if the row is still PENDING_PAYMENT,
   * still unpaid and still overdue at write time. Racing activateIfPending, exactly one wins:
   * the loser sees status/paymentTransactionId changed and affects 0 rows.
   */
  cancelIfPaymentOverdue: (id: string, now: Date, reason: string) =>
    prisma.contract.updateMany({
      where: {
        id,
        status: ContractStatus.PENDING_PAYMENT,
        paymentTransactionId: null,
        paymentDueAt: { lte: now },
      },
      data: { status: ContractStatus.CANCELLED, cancelledBy: "SYSTEM", cancellationReason: reason },
    }),

  /**
   * Guarded extension of the payment deadline: ONE UPDATE ... WHERE, only while the row is still
   * PENDING_PAYMENT, unpaid and its current deadline is EARLIER than `to` — so it can never pull a
   * deadline back, never revives a CANCELLED contract, and never gives a deadline to a legacy row
   * that has none (NULL does not match `lt`). Racing the sweep, exactly one wins.
   */
  extendPaymentDueAt: (id: string, to: Date) =>
    prisma.contract.updateMany({
      where: {
        id,
        status: ContractStatus.PENDING_PAYMENT,
        paymentTransactionId: null,
        paymentDueAt: { lt: to },
      },
      data: { paymentDueAt: to },
    }),

  /**
   * Contracts whose PT holdback is due for release because nothing has happened on them for a
   * long time (the idle-release sweep's candidates; also re-run per id right before the money call).
   *
   * The rule, exactly. A contract qualifies when ALL of:
   *   · status ACTIVE, paid (paymentTransactionId set), ptHoldbackRate > 0, holdbackReleasedAt null;
   *   · activated at least `idleDays` ago (startDate is stamped at activation by
   *     activateIfPendingGuarded; there is no separate activatedAt);
   *   · NO session counts as activity, where a session counts when it is
   *       - in a state that still holds the contract's entitlement — REQUESTED, CONFIRMED,
   *         PENDING_CLIENT_CONFIRMATION, DISPUTED, PT_NO_SHOW_REPORTED (docs/money-flow.md
   *         "business-rules-session-lifecycle" §1.1), whatever its start time, future included; or
   *       - COMPLETED or NO_SHOW with a start time inside the last `idleDays` days.
   *     CANCELLED never counts: nothing happened and the slot no longer holds anything.
   * It is deliberately a SUPERSET of "a holding-state session starting in the last N days or in the
   * future": a session left unresolved for longer (a dispute waiting for an admin, say) must keep
   * the money held, and a PT who has stopped turning up (NO_SHOW) must not have the holdback
   * released as if the contract had merely been quiet.
   */
  findIdleHoldbackCandidates: (opts: { activatedBefore: Date; sessionsSince: Date; limit?: number; id?: string }) =>
    prisma.contract.findMany({
      where: {
        ...(opts.id ? { id: opts.id } : {}),
        status: ContractStatus.ACTIVE,
        holdbackReleasedAt: null,
        ptHoldbackRate: { gt: 0 },
        paymentTransactionId: { not: null },
        startDate: { lte: opts.activatedBefore },
        sessions: {
          none: {
            OR: [
              {
                status: {
                  in: [
                    SessionStatus.REQUESTED,
                    SessionStatus.CONFIRMED,
                    SessionStatus.PENDING_CLIENT_CONFIRMATION,
                    SessionStatus.DISPUTED,
                    SessionStatus.PT_NO_SHOW_REPORTED,
                  ],
                },
              },
              {
                status: { in: [SessionStatus.COMPLETED, SessionStatus.NO_SHOW] },
                scheduledStartAt: { gte: opts.sessionsSince },
              },
            ],
          },
        },
      },
      orderBy: { startDate: "asc" },
      take: opts.limit ?? 200,
    }),

  /**
   * Guarded mark: ONE UPDATE ... WHERE, so a contract's holdback is recorded as released exactly
   * once even if two sweeps overlap (two instances, or a retry after a crash) — the loser sees
   * holdbackReleasedAt already set and affects 0 rows. What the release actually moved is added to
   * releasedToPt IN THE SAME UPDATE, so it is counted once and only by the winner: termination
   * hands releasedToPt back to payment-service as `alreadyReleased`, and an uncounted release
   * would be paid to the PT a second time out of the client's refund.
   */
  markHoldbackReleased: (id: string, released: Prisma.Decimal, now: Date) =>
    prisma.contract.updateMany({
      where: { id, status: ContractStatus.ACTIVE, holdbackReleasedAt: null },
      data: { holdbackReleasedAt: now, releasedToPt: { increment: released } },
    }),

  /** Admin: list all contracts with pagination */
  findAll: (skip = 0, take = 50, status?: ContractStatus) =>
    prisma.contract.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),

  /** Admin: count contracts per user for a list of user IDs.
   *  Returns { [userId]: count } combining both PT and client roles.
   */
  /**
   * Phase 5 (quản lý đối tác phòng tập) — đếm hợp đồng PT đang chạy tại các chi nhánh của
   * một đối tác, cho màn xác nhận "Chấm dứt hợp tác" bên gym-service. Chỉ ACTIVE mới tính
   * là "đang chạy" — PENDING_* chưa có tiền vào, COMPLETED/EXPIRED/CANCELLED/REJECTED đã
   * xong việc, chấm dứt đối tác không ảnh hưởng gì tới chúng.
   */
  async countActiveByGyms(gymIds: string[]): Promise<number> {
    if (gymIds.length === 0) return 0;
    return prisma.contract.count({ where: { gymId: { in: gymIds }, status: 'ACTIVE' } });
  },

  async countByUsers(userIds: string[]): Promise<Record<string, number>> {
    if (userIds.length === 0) return {};
    const [asPT, asClient] = await Promise.all([
      prisma.contract.groupBy({
        by: ["ptUserId"],
        where: { ptUserId: { in: userIds } },
        _count: true,
      }),
      prisma.contract.groupBy({
        by: ["clientUserId"],
        where: { clientUserId: { in: userIds } },
        _count: true,
      }),
    ]);
    const result: Record<string, number> = {};
    for (const row of asPT)
      result[row.ptUserId] = (result[row.ptUserId] ?? 0) + row._count;
    for (const row of asClient)
      result[row.clientUserId] = (result[row.clientUserId] ?? 0) + row._count;
    return result;
  },

  /** Admin: count total active contracts in the system */
  countActive: () =>
    prisma.contract.count({
      where: { status: ContractStatus.ACTIVE },
    }),

  updateESignFields: (id: string, data: Record<string, unknown>) =>
    prisma.contract.update({ where: { id }, data }),

  findByESignRequestId: (eSignRequestId: string) =>
    prisma.contract.findFirst({ where: { eSignRequestId } }),

  updateWhereStatus: (
    id: string,
    expectedStatus: ContractStatus,
    newStatus: ContractStatus,
    data?: Record<string, any>,
  ) =>
    prisma.contract.updateMany({
      where: { id, status: expectedStatus },
      data: { ...data, status: newStatus },
    }),

  /**
   * Guarded cancel for the manual path (cancelContract): ONE UPDATE ... WHERE status = <the
   * status the caller just read>, so a contract that became ACTIVE (a payment landed) between
   * the read and this write is not overwritten with CANCELLED — that would be a paid contract
   * cancelled with no refund. Returns the updated row, or null when the row had moved on.
   */
  async updateStatusIfCurrent(
    id: string,
    expectedStatus: ContractStatus,
    status: ContractStatus,
    extra?: Record<string, any>,
  ) {
    const { count } = await prisma.contract.updateMany({
      where: { id, status: expectedStatus },
      data: { status, ...extra },
    });
    if (count === 0) return null;
    return prisma.contract.findUnique({ where: { id } });
  },

  /** Idempotent activation: only flips PENDING_PAYMENT -> ACTIVE; a repeat call is a no-op. */
  async activateIfPending(id: string, paymentTransactionId: string) {
    return (await contractRepository.activateIfPendingGuarded(id, paymentTransactionId)).contract;
  },

  /**
   * The activation itself: ONE UPDATE ... WHERE status = PENDING_PAYMENT, decided by the
   * affected-row count. The previous read-then-update let a cancel that landed between the two
   * be overwritten with ACTIVE. Racing a cancel (manual or the payment-deadline sweep), exactly
   * one wins and the loser changes nothing.
   *
   * Returns the row as it is AFTER this call plus `flipped`: true only for the call that
   * actually performed PENDING_PAYMENT -> ACTIVE. The caller decides what the final state means
   * (activated by this payment / replay of the same payment / not activatable) — this function
   * never claims success for a row it did not flip.
   */
  async activateIfPendingGuarded(id: string, paymentTransactionId: string) {
    const contract = await prisma.contract.findUnique({ where: { id } });
    if (!contract) return { contract: null, flipped: false };
    if (contract.status !== ContractStatus.PENDING_PAYMENT) return { contract, flipped: false };
    const startDate = contract.startDate ?? new Date();
    // Money-flow plan 3.6: validityDays (frozen at signing from the package) applies to
    // endDate here, the moment the contract actually activates — not at signing time, when
    // payment (and so the real start of the clock) has not happened yet. Null = no expiry,
    // preserving today's behavior for every package that never declared one.
    const endDate =
      contract.validityDays != null
        ? new Date(startDate.getTime() + contract.validityDays * 24 * 60 * 60 * 1000)
        : contract.endDate;
    const { count } = await prisma.contract.updateMany({
      where: { id, status: ContractStatus.PENDING_PAYMENT },
      data: { status: ContractStatus.ACTIVE, startDate, endDate, paymentTransactionId },
    });
    // Re-read either way: after a lost race the row is whatever the winner made it.
    return { contract: await prisma.contract.findUnique({ where: { id } }), flipped: count > 0 };
  },

  /** Idempotent: only cancels an ACTIVE contract (a repeat call after it's already CANCELLED is a no-op). */
  async cancelAfterRefund(id: string) {
    const contract = await prisma.contract.findUnique({ where: { id } });
    if (!contract) return null;
    if (contract.status === ContractStatus.CANCELLED) return contract; // already done — no-op
    return prisma.contract.update({
      where: { id },
      data: { status: ContractStatus.CANCELLED, cancelledBy: 'payment-service-refund', cancellationReason: 'Refunded' },
    });
  },
};
