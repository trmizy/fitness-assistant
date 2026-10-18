import { Prisma, SessionMode } from "../generated/prisma";
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

  /**
   * The package row with a SHARE row lock, for use INSIDE a transaction (`tx`). While the lock is held, an update
   * of that row (the listing-apply transaction takes FOR UPDATE) waits; if one is already running, this read waits
   * for it and sees the committed result. That is what makes "read the package, check its version, snapshot it
   * onto the contract" one atomic step in requestContract.
   */
  findByIdForShare: async (id: string, tx: Prisma.TransactionClient): Promise<LockedPackageRow | null> => {
    const rows = await tx.$queryRaw<LockedPackageRow[]>`
      SELECT id, pt_user_id AS "ptUserId", name, description, session_count AS "sessionCount", price,
             session_mode AS "sessionMode", session_duration_minutes AS "sessionDurationMinutes",
             validity_days AS "validityDays", is_active AS "isActive", archived_at AS "archivedAt", version
      FROM pt_service_packages
      WHERE id = ${id}
      FOR SHARE`;
    return rows[0] ?? null;
  },

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
    price: Prisma.Decimal;
    sessionMode: SessionMode;
    sessionDurationMinutes?: number;
    validityDays?: number;
  }) =>
    prisma.pTServicePackage.create({ data }),

  /**
   * INTERNAL: only the listing-apply transaction (through ptServicePackageService) may call this. `data` is typed
   * to the commercial fields (+ the version bump) on purpose - never pass a request body here.
   */
  update: (id: string, data: PackageUpdateData) =>
    prisma.pTServicePackage.update({
      where: { id },
      data,
    }),

  /**
   * Same three writes, on the caller's transaction client. The listing-apply transaction holds FOR UPDATE row locks
   * on these rows, so it must write them on ITS connection - the plain versions above run on a different one and
   * would wait on that very lock forever.
   */
  createTx: (
    tx: Prisma.TransactionClient,
    data: {
      ptUserId: string;
      name: string;
      description?: string | null;
      sessionCount: number;
      price: Prisma.Decimal;
      sessionMode: SessionMode;
      sessionDurationMinutes: number;
      validityDays?: number | null;
      isActive?: boolean;
    },
  ) => tx.pTServicePackage.create({ data }),

  updateTx: (tx: Prisma.TransactionClient, id: string, data: PackageUpdateData) =>
    tx.pTServicePackage.update({ where: { id }, data }),

  archiveTx: (tx: Prisma.TransactionClient, id: string) =>
    tx.pTServicePackage.update({
      where: { id },
      data: { archivedAt: new Date(), isActive: false, version: { increment: 1 } },
    }),

  /** Soft-delete: sets archivedAt. Never hard-deletes. */
  archive: (id: string) =>
    prisma.pTServicePackage.update({
      where: { id },
      data: { archivedAt: new Date(), isActive: false, version: { increment: 1 } },
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

/** The only columns an update may carry (+ the version bump). */
export interface PackageUpdateData {
  name?: string;
  description?: string | null;
  sessionCount?: number;
  price?: Prisma.Decimal;
  sessionMode?: SessionMode;
  sessionDurationMinutes?: number;
  validityDays?: number | null;
  isActive?: boolean;
  version?: { increment: number };
}

/** A pt_service_packages row as read by {@link ptServicePackageRepository.findByIdForShare}. */
export interface LockedPackageRow {
  id: string;
  ptUserId: string;
  name: string;
  description: string | null;
  sessionCount: number;
  price: Prisma.Decimal;
  sessionMode: SessionMode;
  sessionDurationMinutes: number;
  validityDays: number | null;
  isActive: boolean;
  archivedAt: Date | null;
  version: number;
}
