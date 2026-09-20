import { Prisma, PartnerAccountRole, GymPartnerStatus } from '../generated/prisma';
import { prisma } from './prisma';

/**
 * Phase 1 — truy cập dữ liệu cho bộ ba GymPartner / GymPartnerAccount / PartnerInvitation.
 * Không có logic nghiệp vụ ở đây: mọi bất biến nằm ở partner.service.ts (và ở các ràng
 * buộc CSDL trong migration 20260908000000).
 */
export const partnerRepository = {
  // ── GymPartner ────────────────────────────────────────────────────────────
  createPartner(data: Prisma.GymPartnerCreateInput) {
    return prisma.gymPartner.create({ data });
  },

  findPartnerById(id: string) {
    return prisma.gymPartner.findUnique({ where: { id } });
  },

  findPartnerByIdWithAccounts(id: string) {
    return prisma.gymPartner.findUnique({
      where: { id },
      include: { accounts: { orderBy: { createdAt: 'asc' } } },
    });
  },

  findPartnerByBrandId(brandId: string) {
    return prisma.gymPartner.findUnique({ where: { brandId } });
  },

  listPartners(filter?: { status?: GymPartnerStatus; verificationStatus?: Prisma.GymPartnerWhereInput['verificationStatus']; assignedAdminId?: string }) {
    const where: Prisma.GymPartnerWhereInput = {};
    if (filter?.status) where.status = filter.status;
    if (filter?.verificationStatus) where.verificationStatus = filter.verificationStatus;
    if (filter?.assignedAdminId) where.assignedAdminId = filter.assignedAdminId;
    return prisma.gymPartner.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { accounts: true },
    });
  },

  updatePartner(id: string, data: Prisma.GymPartnerUpdateInput) {
    return prisma.gymPartner.update({ where: { id }, data });
  },

  // ── GymPartnerAccount ─────────────────────────────────────────────────────
  createAccount(data: Prisma.GymPartnerAccountUncheckedCreateInput) {
    return prisma.gymPartnerAccount.create({ data });
  },

  /** Tra cứu nóng: mọi yêu cầu của chủ gym/quản lý đều đi qua đây (xem partner-context). */
  findAccountByUserId(userId: string) {
    return prisma.gymPartnerAccount.findUnique({
      where: { userId },
      include: { partner: true },
    });
  },

  /**
   * Bằng chứng DUY NHẤT cho phép coi một tài khoản GYM_OWNER không có hồ sơ đối tác là "chủ gym có
   * từ trước mô hình đối tác": đang thực sự đứng tên một Gym hoặc một Brand. Chỉ "có vai trò
   * GYM_OWNER" thì KHÔNG đủ — 11 user GYM_OWNER mồ côi ở DB dev không sở hữu gì cả.
   */
  async userHasLegacyOwnership(userId: string): Promise<boolean> {
    const [gym, brand] = await Promise.all([
      prisma.gym.findFirst({ where: { ownerId: userId }, select: { id: true } }),
      prisma.gymBrand.findFirst({ where: { ownerId: userId }, select: { id: true } }),
    ]);
    return Boolean(gym || brand);
  },

  findAccountById(id: string) {
    return prisma.gymPartnerAccount.findUnique({ where: { id }, include: { partner: true } });
  },

  listAccountsByPartner(partnerId: string) {
    return prisma.gymPartnerAccount.findMany({
      where: { partnerId },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
  },

  /** Dùng cho bất biến "không thu hồi tài khoản OWNER cuối cùng". */
  countActiveOwners(partnerId: string) {
    return prisma.gymPartnerAccount.count({
      where: { partnerId, role: PartnerAccountRole.OWNER, status: 'ACTIVE' },
    });
  },

  /** Mọi tài khoản OWNER đang hoạt động thuộc một đối tác đang SUSPENDED hoặc TERMINATED
   * — dùng để ẩn chi nhánh của họ khỏi trang tìm kiếm công khai (Phase 5 mục 5.1: "Hiển
   * thị trên trang tìm kiếm công khai ❌ ẩn"; chấm dứt hợp tác thì càng phải ẩn). */
  listAccountsWithHiddenPartner() {
    return prisma.gymPartnerAccount.findMany({
      where: { role: PartnerAccountRole.OWNER, status: 'ACTIVE', partner: { status: { in: ['SUSPENDED', 'TERMINATED'] } } },
      select: { userId: true },
    });
  },

  findActiveOwnerAccount(partnerId: string) {
    return prisma.gymPartnerAccount.findFirst({
      where: { partnerId, role: PartnerAccountRole.OWNER, status: 'ACTIVE' },
    });
  },

  updateAccount(id: string, data: Prisma.GymPartnerAccountUpdateInput) {
    return prisma.gymPartnerAccount.update({ where: { id }, data });
  },

  // ── PartnerInvitation ─────────────────────────────────────────────────────
  createInvitation(data: Prisma.PartnerInvitationUncheckedCreateInput) {
    return prisma.partnerInvitation.create({ data });
  },

  /** Chỉ tra được bằng băm — token gốc không tồn tại ở đâu trong CSDL. */
  findInvitationByTokenHash(tokenHash: string) {
    return prisma.partnerInvitation.findUnique({
      where: { tokenHash },
      include: { partner: true },
    });
  },

  findInvitationById(id: string) {
    return prisma.partnerInvitation.findUnique({ where: { id }, include: { partner: true } });
  },

  listInvitationsByPartner(partnerId: string) {
    return prisma.partnerInvitation.findMany({
      where: { partnerId },
      orderBy: { createdAt: 'desc' },
    });
  },

  listPendingInvitations(partnerId: string, email?: string) {
    return prisma.partnerInvitation.findMany({
      where: { partnerId, status: 'PENDING', ...(email ? { email } : {}) },
    });
  },

  updateInvitation(id: string, data: Prisma.PartnerInvitationUpdateInput) {
    return prisma.partnerInvitation.update({ where: { id }, data });
  },

  /** Vô hiệu hoá hàng loạt thư mời cũ khi gửi lại (Phase 2: "thư cũ hết hiệu lực"). */
  revokePendingInvitations(partnerId: string, email: string) {
    return prisma.partnerInvitation.updateMany({
      where: { partnerId, email, status: 'PENDING' },
      data: { status: 'REVOKED' },
    });
  },
};
