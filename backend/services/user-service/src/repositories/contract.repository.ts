import { ContractStatus, ContractSource, PackageType, SessionMode, Prisma } from "../generated/prisma";
import { prisma } from "./profile.repository";

export const contractRepository = {
  create: (data: {
    ptUserId: string;
    clientUserId: string;
    status?: ContractStatus;
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
    source?: ContractSource;
    platformRate?: Prisma.Decimal | string;
    ptRate?: Prisma.Decimal | string;
    gymRate?: Prisma.Decimal | string;
  }) => prisma.contract.create({ data }),

  findById: (id: string) => prisma.contract.findUnique({ where: { id } }),

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

  /** Find all expired active contracts */
  findExpiredContracts: () =>
    prisma.contract.findMany({
      where: {
        status: ContractStatus.ACTIVE,
        endDate: { lt: new Date() },
      },
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

  /** Idempotent activation: only flips PENDING_PAYMENT -> ACTIVE; a repeat call is a no-op. */
  async activateIfPending(id: string, paymentTransactionId: string) {
    const contract = await prisma.contract.findUnique({ where: { id } });
    if (!contract) return null;
    if (contract.status === ContractStatus.ACTIVE) return contract; // already done — no-op
    if (contract.status !== ContractStatus.PENDING_PAYMENT) return contract;
    return prisma.contract.update({
      where: { id },
      data: { status: ContractStatus.ACTIVE, startDate: contract.startDate ?? new Date(), paymentTransactionId },
    });
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
