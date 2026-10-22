import { ContractStatus, ContractSource, PackageType, SessionMode, Prisma } from "../generated/prisma";
import { prisma } from "./profile.repository";
import { policyVersionForRate } from "../services/pt-holdback-policy";

/** Vòng 4 / Phase A3 — same reasoning as session.repository.ts's own Db type: findById needs
 *  to run on whichever connection currently holds withPtScheduleLock's advisory lock, so a
 *  caller reading the contract INSIDE that lock sees a truly fresh row (not one read before
 *  the lock was ever acquired). Defaults to the singleton client everywhere else. */
type Db = typeof prisma | Prisma.TransactionClient;

/** Statuses in which a PT-client contract is still alive (BR-27). Must match the partial unique index
 *  contracts_one_live_per_pair (migration 20261021130000), which additionally exempts source MARKETPLACE. */
const NON_TERMINAL_PAIR_STATUSES: ContractStatus[] = [
  ContractStatus.PENDING_REVIEW,
  ContractStatus.PENDING_SIGNATURE,
  ContractStatus.PENDING_PAYMENT,
  ContractStatus.ACTIVE,
];

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
    // PT holdback rate, snapshotted at creation (see pt-holdback-rate.ts). Omitted → schema default 0. The policy version it was decided
    // under is stamped here from the rate (0 for no holdback), so a caller cannot snapshot a rate without its version.
    ptHoldbackRate?: Prisma.Decimal | string;
    paymentTransactionId?: string;
    /** Phase 3 / P3.2 snapshot of the PT-gym agreement behind the rates (all null when not recorded). */
    gymBrandId?: string | null;
    gymAgreementId?: string | null;
    gymAgreementScope?: string | null;
    gymMembershipId?: string | null;
  }, db: Db = prisma) => db.contract.create({ data: { ...data, ptHoldbackPolicyVersion: policyVersionForRate(data.ptHoldbackRate) } }),

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

  /** Find active/pending contract between specific PT and client (BR-27).
   *  Every non-terminal status counts, PENDING_PAYMENT included: a contract awaiting the client's payment is
   *  still a live request, and a second one beside it would send the client two payment requests for one PT.
   *  Pass the transaction client to run the same check under the pair lock (see lockPtClientPair). */
  findActiveByPair: (ptUserId: string, clientUserId: string, db: Db = prisma) =>
    db.contract.findFirst({
      where: {
        ptUserId,
        clientUserId,
        status: { in: NON_TERMINAL_PAIR_STATUSES },
      },
    }),

  /** Same statuses as findActiveByPair, but ignoring marketplace-originated contracts. Used BEFORE a personalized
   *  service is paid for: a standing PT contract with this PT is a conflict, a previous marketplace order is not
   *  (repeat purchases from one PT are allowed; a marketplace contract has no end the buyer could wait for). */
  findNonMarketplaceActiveByPair: (ptUserId: string, clientUserId: string, db: Db = prisma) =>
    db.contract.findFirst({
      where: {
        ptUserId,
        clientUserId,
        source: { not: ContractSource.MARKETPLACE },
        status: { in: NON_TERMINAL_PAIR_STATUSES },
      },
      select: { id: true, status: true },
    }),

  /** Serialises contract creation for ONE PT-client pair (transaction-scoped advisory lock). A second creator for
   *  the same pair waits here until the first commits, then re-runs the active-pair check and sees its row. */
  lockPtClientPair: async (tx: Prisma.TransactionClient, ptUserId: string, clientUserId: string) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"contract-pair:" + ptUserId + ":" + clientUserId}, 0))`;
  },

  /** A contract already created for this payment (marketplace retries must not create a second one). */
  findByPaymentTransactionId: (paymentTransactionId: string, db: Db = prisma) =>
    db.contract.findFirst({ where: { paymentTransactionId } }),

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

  /**
   * `db` = the contract-locked transaction of the decision this count belongs to (Phase 0 / D58 atomicity): the count
   * must commit or roll back TOGETHER with the session claim and the settlement intent row, never on its own connection.
   */
  incrementSession: (id: string, db: Db = prisma) =>
    db.contract.update({
      where: { id },
      data: { usedSessions: { increment: 1 } },
    }),

  /** Money-flow plan 1.5: a PT no-show consumes one entitlement WITHOUT touching
   * totalSessions (immutable once signed) or usedSessions (reserved for sessions the client
   * actually trained, or was charged for by cancelling late). */
  incrementCompensatedSessions: (id: string, notes?: string, db: Db = prisma) =>
    db.contract.update({
      where: { id },
      data: { compensatedSessions: { increment: 1 }, ...(notes !== undefined && { notes }) },
    }),

  /** What the ledger really released to each party for a session - the sub-ledger termination hands back as `alreadyReleased`. */
  addReleased: (
    id: string,
    moved: { pt: Prisma.Decimal.Value; gym: Prisma.Decimal.Value; platform: Prisma.Decimal.Value },
    db: Db = prisma,
  ) =>
    db.contract.update({
      where: { id },
      data: {
        releasedToPt: { increment: new Prisma.Decimal(moved.pt) },
        releasedToGym: { increment: new Prisma.Decimal(moved.gym) },
        releasedToPlatform: { increment: new Prisma.Decimal(moved.platform) },
      },
    }),

  /**
   * Find all expired active contracts. `excludePtUserIds` = PTs that are restricted right now: their
   * contracts are PAUSED_BY_ADMIN (pt-restriction.service.ts), their clock is stopped, and they must
   * never be picked up for expiry — the exclusion is IN the query so a batch can't be starved either.
   * `excludeContractIds` = contracts paused on their own (CONTRACT-scope restriction): same rule, one contract.
   */
  findExpiredContracts: (excludePtUserIds: string[] = [], excludeContractIds: string[] = []) =>
    prisma.contract.findMany({
      where: {
        status: ContractStatus.ACTIVE,
        endDate: { lt: new Date() },
        ...(excludePtUserIds.length > 0 ? { ptUserId: { notIn: excludePtUserIds } } : {}),
        ...(excludeContractIds.length > 0 ? { id: { notIn: excludeContractIds } } : {}),
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
   *
   * D13: every extension that really moves the deadline stamps payment_deadline_extended_at. With `{ once: true }`
   * (the default; only CHECKOUT_EXTENSION_ONCE=false drops it) the same statement also requires that column to be NULL, so a contract is extended AT MOST ONCE
   * and two simultaneous callers cannot both win - the database arbitrates, not the caller.
   */
  extendPaymentDueAt: (id: string, to: Date, opts: { once?: boolean } = {}) =>
    prisma.contract.updateMany({
      where: {
        id,
        status: ContractStatus.PENDING_PAYMENT,
        paymentTransactionId: null,
        paymentDueAt: { lt: to },
        ...(opts.once ? { paymentDeadlineExtendedAt: null } : {}),
      },
      data: { paymentDueAt: to, paymentDeadlineExtendedAt: new Date() },
    }),

  /**
   * FH-9. Contracts that carry a PT holdback and have ENDED, whose holdback the sweep has not yet seen settled - the sweep's candidates
   * (a contract whose ending is confirmed but whose held money is waiting for an open obligation / an undecided session, or whose
   * natural completion has not reached payment-service yet). payment-service decides whether the release is due; this only lists.
   *
   * The rule, exactly: status COMPLETED / EXPIRED / CANCELLED (an ended contract), paid (paymentTransactionId set), created under a known
   * holdback policy (ptHoldbackPolicyVersion > 0 and ptHoldbackRate > 0 - an old row can never qualify), holdbackReleasedAt null.
   * There is no idle clock any more: a running contract's holdback is never released early, however quiet it is.
   */
  findEndedHoldbackCandidates: (opts: { limit?: number; id?: string } = {}) =>
    prisma.contract.findMany({
      where: {
        ...(opts.id ? { id: opts.id } : {}),
        status: { in: [ContractStatus.COMPLETED, ContractStatus.EXPIRED, ContractStatus.CANCELLED] },
        holdbackReleasedAt: null,
        ptHoldbackRate: { gt: 0 },
        ptHoldbackPolicyVersion: { gt: 0 },
        paymentTransactionId: { not: null },
      },
      orderBy: { updatedAt: "asc" },
      take: opts.limit ?? 200,
    }),

  /**
   * Guarded mark: ONE UPDATE ... WHERE holdbackReleasedAt IS NULL, so it is recorded exactly once however many sweeps overlap. It is a
   * flag only - the ledger (payment-service) is the authority for the amounts, and the mark is written whatever status the contract
   * has by now (Z4: it used to require ACTIVE, so a contract that ended before the sweep got its money released but never recorded).
   */
  markHoldbackReleased: (id: string, now: Date) =>
    prisma.contract.updateMany({
      where: { id, holdbackReleasedAt: null },
      data: { holdbackReleasedAt: now },
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
