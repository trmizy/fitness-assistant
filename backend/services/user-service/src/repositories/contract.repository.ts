import { ContractStatus, PackageType } from '../generated/prisma';
import { prisma } from './profile.repository';

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
    startDate?: Date;
    endDate?: Date;
    clientMessage?: string;
    terms?: string;
    notes?: string;
  }) =>
    prisma.contract.create({ data }),

  findById: (id: string) => prisma.contract.findUnique({ where: { id } }),

  findByIdWithSessions: (id: string) =>
    prisma.contract.findUnique({
      where: { id },
      include: {
        sessions: { orderBy: { scheduledStartAt: 'asc' } },
        reviews: true,
      },
    }),

  findByPT: (ptUserId: string, status?: ContractStatus) =>
    prisma.contract.findMany({
      where: { ptUserId, ...(status && { status }) },
      orderBy: { createdAt: 'desc' },
    }),

  findByClient: (clientUserId: string, status?: ContractStatus) =>
    prisma.contract.findMany({
      where: { clientUserId, ...(status && { status }) },
      orderBy: { createdAt: 'desc' },
    }),

  /** Find any ACTIVE or PENDING_REVIEW contract for a client (across all PTs) */
  findActiveOrPendingByClient: (clientUserId: string) =>
    prisma.contract.findFirst({
      where: {
        clientUserId,
        status: { in: [ContractStatus.ACTIVE, ContractStatus.PENDING_REVIEW] },
      },
    }),

  /** Find active/pending contract between specific PT and client */
  findActiveByPair: (ptUserId: string, clientUserId: string) =>
    prisma.contract.findFirst({
      where: {
        ptUserId,
        clientUserId,
        status: { in: [ContractStatus.ACTIVE, ContractStatus.PENDING_REVIEW] },
      },
    }),

  updateStatus: (id: string, status: ContractStatus, extra?: Record<string, any>) =>
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
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
};
