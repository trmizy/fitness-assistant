import { Decimal } from "@prisma/client/runtime/library";
import { SessionMode } from "../generated/prisma";
import { prisma } from "./profile.repository";

export const ptServicePackageRepository = {
  /** All packages for a PT (including archived) — for PT's own management view */
  findAllByPT: (ptUserId: string) =>
    prisma.pTServicePackage.findMany({
      where: { ptUserId },
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    }),

  /** Only active, non-archived packages visible to clients */
  findActiveByPT: (ptUserId: string) =>
    prisma.pTServicePackage.findMany({
      where: { ptUserId, isActive: true, archivedAt: null },
      orderBy: { createdAt: "desc" },
    }),

  findById: (id: string) =>
    prisma.pTServicePackage.findUnique({ where: { id } }),

  findByIdAndOwner: (id: string, ptUserId: string) =>
    prisma.pTServicePackage.findFirst({ where: { id, ptUserId } }),

  /** Count non-archived packages for a PT (enforces max-10 limit) */
  countActive: (ptUserId: string) =>
    prisma.pTServicePackage.count({
      where: { ptUserId, archivedAt: null },
    }),

  create: (data: {
    ptUserId: string;
    name: string;
    description?: string;
    sessionCount: number;
    price: Decimal;
    sessionMode: SessionMode;
    sessionDurationMinutes?: number;
    validityDays?: number;
  }) =>
    prisma.pTServicePackage.create({ data }),

  update: (
    id: string,
    data: {
      name?: string;
      description?: string;
      sessionCount?: number;
      price?: Decimal;
      sessionMode?: SessionMode;
      sessionDurationMinutes?: number;
      validityDays?: number | null;
      isActive?: boolean;
    },
  ) =>
    prisma.pTServicePackage.update({
      where: { id },
      data,
    }),

  /** Soft-delete: sets archivedAt. Never hard-deletes. */
  archive: (id: string) =>
    prisma.pTServicePackage.update({
      where: { id },
      data: { archivedAt: new Date(), isActive: false },
    }),

  /**
   * Check if any active contract references this package id.
   * Used before archiving to warn the PT (but archive proceeds regardless).
   */
  hasActiveContracts: async (id: string): Promise<boolean> => {
    const count = await prisma.contract.count({
      where: {
        packageId: id,
        status: { in: ["ACTIVE", "PENDING_REVIEW", "PENDING_SIGNATURE", "PENDING_PAYMENT"] },
      },
    });
    return count > 0;
  },
};
