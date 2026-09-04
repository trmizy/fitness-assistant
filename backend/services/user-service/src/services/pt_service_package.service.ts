import { AuditEntityType, Prisma, SessionMode } from "../generated/prisma";
import { ptServicePackageRepository } from "../repositories/pt_service_package.repository";
import { profileRepository } from "../repositories/profile.repository";
import { auditService } from "./audit.service";

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
   * Active, non-archived packages visible to clients.
   * Only shown when the PT has isPT = true (verified here).
   */
  async getActivePackagesForPT(ptUserId: string) {
    const profile = await profileRepository.findByUserId(ptUserId);
    if (!profile || !(profile as any).isPT) {
      throw err("PT not found", 404);
    }
    const packages = await ptServicePackageRepository.findActiveByPT(ptUserId);
    return { packages };
  },

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

    const updateData: any = { ...data };
    if (data.name) updateData.name = data.name.trim();
    if (data.description !== undefined) updateData.description = data.description?.trim() || null;
    if (data.price !== undefined) updateData.price = new Prisma.Decimal(data.price);

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
};
