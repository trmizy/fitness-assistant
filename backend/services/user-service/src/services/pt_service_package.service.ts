import { AuditEntityType, Prisma, SessionMode } from "../generated/prisma";
import { ptServicePackageRepository, type PackageUpdateData } from "../repositories/pt_service_package.repository";
import { auditService } from "./audit.service";
import { assertPtMayAct } from "./pt-restriction.service";
import { isPtPubliclyVisible, toPublicPtPackageDto } from "./pt-public-dto";

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

const MAX_PACKAGES_PER_PT = 10;

/**
 * Fields whose change a client could later dispute ("the package said 10 sessions when I
 * bought it"). Contracts snapshot these at signing, so the log is what proves the
 * snapshot was correct at the time rather than merely different from today.
 */
const AUDITED_PACKAGE_FIELDS = [
  "name",
  "sessionCount",
  "price",
  "sessionMode",
  "sessionDurationMinutes",
  "validityDays",
  "isActive",
] as const;

/**
 * The UPDATE for a package edit: an EXPLICIT allowlist, field by field. This used to be `{ ...data }`: whatever keys
 * the caller sent (ptUserId, archivedAt, version, id, ...) went straight into the UPDATE. Nothing outside this list
 * can be written.
 *
 * The version moves only when a commercial field really changes (plan §12.5), so an edit that changes nothing does
 * not invalidate a buyer's expectedPackageVersion for no reason. Compared after normalisation (trim, Decimal).
 */
export function buildPackageUpdate(
  pkg: {
    name: string;
    description: string | null;
    sessionCount: number;
    price: Prisma.Decimal;
    sessionMode: SessionMode;
    sessionDurationMinutes: number;
    validityDays: number | null;
    isActive: boolean;
  },
  data: {
    name?: string;
    description?: string | null;
    sessionCount?: number;
    price?: number;
    sessionMode?: SessionMode;
    sessionDurationMinutes?: number;
    validityDays?: number | null;
    isActive?: boolean;
  },
): PackageUpdateData {
  const updateData: PackageUpdateData = {};
  if (data.name !== undefined) updateData.name = data.name.trim();
  if (data.description !== undefined) updateData.description = data.description?.trim() || null;
  if (data.sessionCount !== undefined) updateData.sessionCount = data.sessionCount;
  if (data.price !== undefined) updateData.price = new Prisma.Decimal(data.price);
  if (data.sessionMode !== undefined) updateData.sessionMode = data.sessionMode;
  if (data.sessionDurationMinutes !== undefined) updateData.sessionDurationMinutes = data.sessionDurationMinutes;
  if (data.validityDays !== undefined) updateData.validityDays = data.validityDays;
  if (data.isActive !== undefined) updateData.isActive = data.isActive;

  const priceChanged = updateData.price !== undefined && !updateData.price.equals(pkg.price);
  const otherChanged = (
    [
      [updateData.name, pkg.name],
      [updateData.description, pkg.description],
      [updateData.sessionCount, pkg.sessionCount],
      [updateData.sessionMode, pkg.sessionMode],
      [updateData.sessionDurationMinutes, pkg.sessionDurationMinutes],
      [updateData.validityDays, pkg.validityDays],
      [updateData.isActive, pkg.isActive],
    ] as Array<[unknown, unknown]>
  ).some(([next, current]) => next !== undefined && next !== current);
  if (priceChanged || otherChanged) updateData.version = { increment: 1 };
  return updateData;
}

export const ptServicePackageService = {
  /**
   * All packages for a PT's own management view (includes archived).
   * No restriction on PT application status — PTs can manage packages at any stage.
   */
  async getMyPackages(ptUserId: string) {
    const packages = await ptServicePackageRepository.findAllByPT(ptUserId);
    return { packages };
  },

  /**
   * Active, non-archived packages visible to clients, each with its `version`.
   * Same visibility rule as the PT list and detail (ptPublicWhere): a trainer who is suspended, restricted
   * account-wide or not approved is a 404 here, not an empty list - the id cannot be probed past the list's filter.
   */
  async getActivePackagesForPT(ptUserId: string) {
    if (!(await isPtPubliclyVisible(ptUserId))) {
      throw err("PT not found", 404);
    }
    const packages = await ptServicePackageRepository.findActiveByPT(ptUserId);
    return { packages: packages.map(toPublicPtPackageDto) };
  },

  // ── INTERNAL WRITES ────────────────────────────────────────────────────────────────────────
  // createPackage / updatePackage / archivePackage are no longer reachable from any route: all six PT package
  // routes answer 409 LISTING_REVIEW_REQUIRED (pt_service_package.controller.ts). A package changes only through
  // an approved listing revision, whose apply-transaction is the one caller of these three.

  async createPackage(
    ptUserId: string,
    data: {
      name: string;
      description?: string;
      sessionCount: number;
      price: number;
      sessionMode: SessionMode;
      sessionDurationMinutes?: number;
      validityDays?: number;
    },
  ) {
    await assertPtMayAct(ptUserId); // restricted mode: no new service activation while suspended
    // Business rules
    if (!data.name?.trim()) throw err("Tên gói không được để trống", 400);
    if (!Number.isInteger(data.sessionCount) || data.sessionCount < 1)
      throw err("sessionCount phải là số nguyên >= 1", 400);
    if (typeof data.price !== "number" || data.price <= 0)
      throw err("price phải > 0", 400);
    if (data.sessionMode === SessionMode.HYBRID)
      throw err("Gói dịch vụ không hỗ trợ chế độ HYBRID — chọn ONLINE hoặc OFFLINE", 400);
    if (
      data.sessionDurationMinutes !== undefined &&
      (data.sessionDurationMinutes < 15 || data.sessionDurationMinutes > 240)
    )
      throw err("sessionDurationMinutes phải từ 15 đến 240 phút", 400);

    // Enforce max 10 non-archived packages
    const current = await ptServicePackageRepository.countActive(ptUserId);
    if (current >= MAX_PACKAGES_PER_PT)
      throw err(
        `PT chỉ có thể có tối đa ${MAX_PACKAGES_PER_PT} gói đang hoạt động. Lưu trữ bớt gói cũ trước khi tạo mới.`,
        422,
      );

    const pkg = await ptServicePackageRepository.create({
      ptUserId,
      name: data.name.trim(),
      description: data.description?.trim(),
      sessionCount: data.sessionCount,
      price: new Prisma.Decimal(data.price),
      sessionMode: data.sessionMode,
      sessionDurationMinutes: data.sessionDurationMinutes ?? 60,
      validityDays: data.validityDays,
    });

    await auditService.record({
      actorUserId: ptUserId,
      action: "SERVICE_PACKAGE_CREATED",
      entityType: AuditEntityType.SERVICE_PACKAGE,
      entityId: pkg.id,
      metadata: {
        name: pkg.name,
        price: pkg.price.toString(),
        sessionCount: pkg.sessionCount,
        sessionMode: pkg.sessionMode,
      },
    });

    return { package: pkg };
  },

  async updatePackage(
    ptUserId: string,
    packageId: string,
    data: {
      name?: string;
      description?: string;
      sessionCount?: number;
      price?: number;
      sessionMode?: SessionMode;
      sessionDurationMinutes?: number;
      validityDays?: number | null;
      isActive?: boolean;
    },
  ) {
    await assertPtMayAct(ptUserId); // restricted mode: a suspended PT does not re-activate or reprice offers
    const pkg = await ptServicePackageRepository.findByIdAndOwner(packageId, ptUserId);
    if (!pkg) throw err("Gói không tồn tại hoặc bạn không có quyền sửa", 404);
    if (pkg.archivedAt) throw err("Không thể sửa gói đã lưu trữ", 422);

    // Validate fields if provided
    if (data.name !== undefined && !data.name.trim())
      throw err("Tên gói không được để trống", 400);
    if (data.sessionCount !== undefined && (!Number.isInteger(data.sessionCount) || data.sessionCount < 1))
      throw err("sessionCount phải là số nguyên >= 1", 400);
    if (data.price !== undefined && data.price <= 0)
      throw err("price phải > 0", 400);
    if (data.sessionMode === SessionMode.HYBRID)
      throw err("Gói dịch vụ không hỗ trợ chế độ HYBRID", 400);

    if (
      data.sessionDurationMinutes !== undefined &&
      (!Number.isInteger(data.sessionDurationMinutes) || data.sessionDurationMinutes < 15 || data.sessionDurationMinutes > 240)
    )
      throw err("sessionDurationMinutes phải từ 15 đến 240 phút", 400);
    if (data.validityDays != null && (!Number.isInteger(data.validityDays) || data.validityDays < 1))
      throw err("validityDays phải là số nguyên >= 1", 400);

    const updateData = buildPackageUpdate(pkg, data);

    const updated = await ptServicePackageRepository.update(packageId, updateData);

    // Only the fields that actually moved. Logging the whole row on every edit would bury
    // a price change among a dozen unchanged values.
    const changes: Record<string, { before: string; after: string }> = {};
    for (const field of AUDITED_PACKAGE_FIELDS) {
      const before = pkg[field];
      const after = updated[field];
      if (String(before) !== String(after)) {
        changes[field] = { before: String(before), after: String(after) };
      }
    }
    if (Object.keys(changes).length > 0) {
      await auditService.record({
        actorUserId: ptUserId,
        action: "SERVICE_PACKAGE_UPDATED",
        entityType: AuditEntityType.SERVICE_PACKAGE,
        entityId: packageId,
        metadata: { changes },
      });
    }

    return { package: updated };
  },

  /**
   * Soft-archive a package.
   * Always succeeds (no hard block). Warns if active contracts reference this package.
   */
  async archivePackage(ptUserId: string, packageId: string) {
    const pkg = await ptServicePackageRepository.findByIdAndOwner(packageId, ptUserId);
    if (!pkg) throw err("Gói không tồn tại hoặc bạn không có quyền", 404);
    if (pkg.archivedAt) throw err("Gói đã được lưu trữ rồi", 422);

    const hasActiveContracts = await ptServicePackageRepository.hasActiveContracts(packageId);
    await ptServicePackageRepository.archive(packageId);

    await auditService.record({
      actorUserId: ptUserId,
      action: "SERVICE_PACKAGE_ARCHIVED",
      entityType: AuditEntityType.SERVICE_PACKAGE,
      entityId: packageId,
      metadata: { name: pkg.name, hasActiveContracts },
    });

    return {
      archived: true,
      hasActiveContracts,
      // UI should display a warning if hasActiveContracts = true:
      // "Gói đã được lưu trữ. Có hợp đồng đang tham chiếu gói này — hợp đồng đó không bị ảnh hưởng."
    };
  },

  // ── TRANSACTIONAL WRITES (the listing-apply transaction) ───────────────────────────────────
  // Same rules as the three methods above, on the caller's transaction client: the apply transaction holds
  // FOR UPDATE locks on the PT's package rows and writes them on its own connection. No assertPtMayAct (an admin
  // is approving, not the PT acting) and no per-package audit row (the listing audit row carries the field diff,
  // written in the same transaction). Callers pass already-validated, schema-checked values.

  async createPackageTx(
    tx: Prisma.TransactionClient,
    ptUserId: string,
    data: {
      name: string;
      description?: string | null;
      sessionCount: number;
      price: number;
      sessionMode: SessionMode;
      sessionDurationMinutes: number;
      validityDays?: number | null;
      isActive?: boolean;
    },
  ) {
    if (data.sessionMode === SessionMode.HYBRID) throw err("Gói dịch vụ không hỗ trợ chế độ HYBRID", 400);
    return ptServicePackageRepository.createTx(tx, {
      ptUserId,
      name: data.name.trim(),
      description: data.description?.trim() || null,
      sessionCount: data.sessionCount,
      price: new Prisma.Decimal(data.price),
      sessionMode: data.sessionMode,
      sessionDurationMinutes: data.sessionDurationMinutes,
      validityDays: data.validityDays ?? null,
      isActive: data.isActive ?? true,
    });
  },

  /** Returns the updated row, or null when nothing commercial changed and nothing was written. */
  async updatePackageTx(
    tx: Prisma.TransactionClient,
    pkg: Parameters<typeof buildPackageUpdate>[0] & { id: string },
    data: Parameters<typeof buildPackageUpdate>[1],
  ) {
    if (data.sessionMode === SessionMode.HYBRID) throw err("Gói dịch vụ không hỗ trợ chế độ HYBRID", 400);
    const updateData = buildPackageUpdate(pkg, data);
    if (updateData.version === undefined) return null; // nothing commercial moved: no write, no version bump
    return ptServicePackageRepository.updateTx(tx, pkg.id, updateData);
  },

  async archivePackageTx(tx: Prisma.TransactionClient, packageId: string) {
    return ptServicePackageRepository.archiveTx(tx, packageId);
  },
};
