import { logger } from '@gym-coach/shared';
import { partnerRepository } from '../repositories/partner.repository';
import type { GymPartnerKind, GymPartnerStatus, PartnerAccountRole } from '../generated/prisma';

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

/**
 * Danh tính đã phân giải của một người đang gọi API, ở góc nhìn đối tác.
 *
 * `principalUserId` là mấu chốt của toàn bộ thiết kế: mọi bảng sẵn có (Gym.ownerId,
 * GymBrand.ownerId) đang khoá theo userId của CHỦ SỞ HỮU. Thay vì viết lại từng câu
 * truy vấn quyền sở hữu trong service, tầng này dịch "ai đang gọi" thành "hồ sơ của
 * ai" — một quản lý gọi API sẽ đi tiếp với principalUserId của chủ sở hữu mình, nên
 * gymService.getOwnedGym và mọi kiểm tra sẵn có chạy y nguyên, không sửa một dòng.
 */
export interface PartnerContext {
  partnerId: string | null;
  accountId: string | null;
  principalUserId: string;
  role: PartnerAccountRole;
  /** Rỗng với OWNER = toàn bộ chi nhánh. */
  scopedGymIds: string[];
  partnerStatus: GymPartnerStatus | null;
  /** Chủ gym có từ trước mô hình đối tác, chưa có hồ sơ — xem doc của resolveContextForUser. */
  isLegacy: boolean;
}

export const partnerService = {
  /**
   * Phân giải userId đang đăng nhập thành ngữ cảnh đối tác.
   *
   * Nhánh dự phòng (`isLegacy`): một tài khoản GYM_OWNER không có hồ sơ đối tác nào vẫn
   * hoạt động đúng như trước — tự làm chủ sở hữu của chính mình, không giới hạn chi
   * nhánh. Migration đã backfill toàn bộ chủ gym đang có, nên nhánh này chỉ còn dành cho
   * CSDL mới seed thẳng vào bảng gyms (môi trường demo/test). Không có nhánh này thì mọi
   * chủ gym hiện hữu ở các môi trường đó sẽ mất quyền vào hệ thống ngay khi phase này
   * lên — một cách hỏng rất im lặng.
   */
  async resolveContextForUser(userId: string): Promise<PartnerContext> {
    const account = await partnerRepository.findAccountByUserId(userId);

    if (!account) {
      return {
        partnerId: null,
        accountId: null,
        principalUserId: userId,
        role: 'OWNER',
        scopedGymIds: [],
        partnerStatus: null,
        isLegacy: true,
      };
    }

    if (account.status !== 'ACTIVE') {
      throw err('Tài khoản đối tác chưa kích hoạt hoặc đã bị thu hồi', 403);
    }

    // Với OWNER, chính họ là gốc quyền sở hữu. Với MANAGER, phải tìm về tài khoản OWNER
    // đang hoạt động của cùng đối tác — đó mới là userId mà các bảng gyms/gym_brands
    // đang khoá theo.
    //
    // ⚠️ Phase 2 lưu ý: "chuyển quyền sở hữu" vì vậy KHÔNG chỉ là đổi cột `role` giữa hai
    // tài khoản — nó phải ghi lại Gym.ownerId và GymBrand.ownerId của đối tác đó sang
    // userId mới trong cùng một giao dịch, nếu không toàn bộ chi nhánh sẽ trở nên vô chủ
    // với chủ mới. Có kiểm chứng ở assertOwnershipConsistent bên dưới.
    const principal =
      account.role === 'OWNER' ? account : await partnerRepository.findActiveOwnerAccount(account.partnerId);

    if (!principal) {
      throw err('Đối tác này không có tài khoản chủ sở hữu đang hoạt động', 409);
    }

    return {
      partnerId: account.partnerId,
      accountId: account.id,
      principalUserId: principal.userId,
      role: account.role,
      scopedGymIds: account.scopedGymIds,
      partnerStatus: account.partner.status,
      isLegacy: false,
    };
  },

  // ── Hồ sơ đối tác ─────────────────────────────────────────────────────────
  async createPartner(
    data: {
      legalName: string;
      partnerKind?: GymPartnerKind;
      taxCode?: string;
      businessLicenseNo?: string;
      contactEmail: string;
      contactPhone?: string;
      commissionRateOverride?: number | null;
    },
    adminId: string,
  ) {
    if (!data.legalName?.trim()) throw err('Tên pháp lý là bắt buộc', 400);
    if (!data.contactEmail?.trim()) throw err('Email liên hệ là bắt buộc', 400);

    return partnerRepository.createPartner({
      legalName: data.legalName.trim(),
      partnerKind: data.partnerKind ?? 'BUSINESS',
      taxCode: data.taxCode?.trim() || null,
      businessLicenseNo: data.businessLicenseNo?.trim() || null,
      contactEmail: data.contactEmail.trim().toLowerCase(),
      contactPhone: data.contactPhone?.trim() || null,
      commissionRateOverride: data.commissionRateOverride ?? null,
      status: 'PROSPECT',
      createdBy: adminId,
    });
  },

  async getPartner(partnerId: string) {
    const partner = await partnerRepository.findPartnerByIdWithAccounts(partnerId);
    if (!partner) throw err('Không tìm thấy đối tác', 404);
    return partner;
  },

  listPartners(filter?: { status?: GymPartnerStatus; verificationStatus?: import('../generated/prisma').PartnerVerificationStatus; assignedAdminId?: string }) {
    return partnerRepository.listPartners(filter);
  },

  /**
   * Gắn thương hiệu duy nhất của đối tác (chủ sở hữu đặt tên ở bước 3 của trình thiết
   * lập lần đầu — Phase 3). Bất biến "tối đa một thương hiệu" có unique index đỡ ở tầng
   * CSDL; kiểm ở đây chỉ để trả về thông báo đọc được thay vì lỗi ràng buộc thô.
   */
  async attachBrand(partnerId: string, brandId: string) {
    const partner = await partnerRepository.findPartnerById(partnerId);
    if (!partner) throw err('Không tìm thấy đối tác', 404);
    if (partner.brandId && partner.brandId !== brandId) {
      throw err('Đối tác này đã có thương hiệu — mỗi đối tác chỉ sở hữu một thương hiệu', 409);
    }
    const taken = await partnerRepository.findPartnerByBrandId(brandId);
    if (taken && taken.id !== partnerId) {
      throw err('Thương hiệu này đã thuộc về một đối tác khác', 409);
    }
    return partnerRepository.updatePartner(partnerId, { brandId });
  },

  // ── Tài khoản trong đối tác ───────────────────────────────────────────────
  listAccounts(partnerId: string) {
    return partnerRepository.listAccountsByPartner(partnerId);
  },

  /**
   * Phase 3 mục 3.2 — chủ sở hữu tự mời quản lý chi nhánh, không cần admin. Khác
   * provisionOwnerAccount (Phase 2, admin-driven, role OWNER) ở chỗ role cố định MANAGER và
   * `scopedGymIds` bắt buộc phải là chi nhánh CHỦ SỞ HỮU NÀY thực sự sở hữu — không thì một
   * chủ gym có thể gán quản lý vào chi nhánh của người khác chỉ bằng cách đoán id.
   */
  async inviteManager(partnerId: string, ownerId: string, data: { email: string; scopedGymIds: string[] }, invitedBy: string) {
    if (!Array.isArray(data.scopedGymIds) || data.scopedGymIds.length === 0) {
      throw err('Phải chọn ít nhất một chi nhánh cho người quản lý', 400);
    }
    const { gymRepository } = await import('../repositories/gym.repository');
    const owned = await gymRepository.findByOwner(ownerId);
    const ownedIds = new Set(owned.map((g) => g.id));
    const invalid = data.scopedGymIds.filter((id) => !ownedIds.has(id));
    if (invalid.length > 0) throw err('Có chi nhánh không thuộc quyền quản lý của bạn', 403);

    const { partnerInvitationService } = await import('./partner-invitation.service');
    return partnerInvitationService.createInvitation({
      partnerId,
      email: data.email,
      role: 'MANAGER',
      scopedGymIds: data.scopedGymIds,
      createdBy: invitedBy,
    });
  },

  /**
   * Thu hồi một tài khoản. Bất biến: KHÔNG được thu hồi tài khoản OWNER cuối cùng đang
   * hoạt động — đối tác mất chủ sở hữu là mất luôn đường vào ví, vào việc mời người, và
   * mọi chi nhánh trở nên vô chủ (principalUserId không phân giải được nữa, kể cả cho
   * các MANAGER còn lại).
   */
  async revokeAccount(accountId: string, revokedBy: string, reason?: string) {
    const account = await partnerRepository.findAccountById(accountId);
    if (!account) throw err('Không tìm thấy tài khoản', 404);
    if (account.status === 'REVOKED') throw err('Tài khoản này đã bị thu hồi', 409);

    if (account.role === 'OWNER') {
      const activeOwners = await partnerRepository.countActiveOwners(account.partnerId);
      if (activeOwners <= 1) {
        throw err(
          'Không thể thu hồi tài khoản chủ sở hữu cuối cùng — hãy chuyển quyền sở hữu cho tài khoản khác trước',
          409,
        );
      }
    }

    logger.info(`[Partner] ${revokedBy} revoked account ${accountId} (${account.role}) of partner ${account.partnerId}`);
    const updated = await partnerRepository.updateAccount(accountId, {
      status: 'REVOKED',
      revokedAt: new Date(),
      revokedReason: reason ?? null,
    });

    // GYM_MANAGEMENT master spec §61 — "Owner revokes the manager → that person's session is
    // terminated immediately." A revoked PartnerAccountStatus alone only blocks their NEXT
    // request (resolveContextForUser checks status === 'ACTIVE'); an already-open session's
    // access token would otherwise keep working until it naturally expires. Reuses the same
    // revokeSessions call the dedicated admin "force logout" action already exposes, so both
    // an owner revoking their own manager AND an admin revoking any account (this function is
    // the one place both routes funnel through) get the same immediate-kick guarantee.
    const { authClient } = await import('../clients/auth.client');
    await authClient.revokeSessions(account.userId).catch((e) =>
      logger.error({ err: e.message, accountId }, '[Partner] thu hồi phiên đăng nhập thất bại khi thu hồi tài khoản'),
    );

    return updated;
  },

  /**
   * Phase 2 mục 2.1 — "Cấp tài khoản": PROSPECT → INVITED, kèm thư mời OWNER hạn 7 ngày.
   *
   * Trả về `rawToken` để phía gọi dựng link; token gốc không tồn tại ở đâu khác.
   */
  async provisionOwnerAccount(partnerId: string, adminId: string) {
    const partner = await partnerRepository.findPartnerById(partnerId);
    if (!partner) throw err('Không tìm thấy đối tác', 404);
    if (partner.status === 'TERMINATED') throw err('Đối tác đã chấm dứt hợp tác', 409);
    if (partner.status === 'ACTIVE') {
      throw err('Đối tác này đã hoạt động — dùng "Đặt lại mật khẩu" nếu chủ sở hữu không vào được', 409);
    }
    if (!partner.contactEmail) throw err('Hồ sơ đối tác chưa có email liên hệ', 400);
    // GYM_MANAGEMENT master spec §60 — đúng thứ tự accept-flow: thẩm định giấy tờ xong
    // (VERIFIED) TRƯỚC khi cấp tài khoản OWNER, không phải song song hay sau đó.
    if (partner.verificationStatus !== 'VERIFIED') {
      throw err('Chỉ cấp tài khoản sau khi hồ sơ đã thẩm định xong (verificationStatus = VERIFIED)', 409);
    }

    const { partnerInvitationService } = await import('./partner-invitation.service');
    const { invitation, rawToken } = await partnerInvitationService.createInvitation({
      partnerId,
      email: partner.contactEmail,
      role: 'OWNER',
      createdBy: adminId,
    });

    // PROSPECT -> INVITED. Đối tác chỉ sang ACTIVE khi chủ sở hữu thật sự nhận thư mời
    // (partnerInvitationService.acceptInvitation), không phải lúc bấm nút ở đây.
    const updated = await partnerRepository.updatePartner(partnerId, { status: 'INVITED' });
    return { partner: updated, invitation, rawToken };
  },

  async updatePartner(
    partnerId: string,
    data: Partial<{
      legalName: string;
      partnerKind: GymPartnerKind;
      taxCode: string | null;
      businessLicenseNo: string | null;
      contactEmail: string;
      contactPhone: string | null;
      commissionRateOverride: number | null;
      expectedBranchCount: number | null;
      negotiationNotes: string | null;
    }>,
  ) {
    const partner = await partnerRepository.findPartnerById(partnerId);
    if (!partner) throw err('Không tìm thấy đối tác', 404);

    const patch: Record<string, unknown> = {};
    if (data.legalName !== undefined) {
      if (!data.legalName.trim()) throw err('Tên pháp lý không được để trống', 400);
      patch.legalName = data.legalName.trim();
    }
    if (data.partnerKind !== undefined) patch.partnerKind = data.partnerKind;
    if (data.taxCode !== undefined) patch.taxCode = data.taxCode?.trim() || null;
    if (data.businessLicenseNo !== undefined) patch.businessLicenseNo = data.businessLicenseNo?.trim() || null;
    if (data.contactEmail !== undefined) patch.contactEmail = data.contactEmail.trim().toLowerCase();
    if (data.contactPhone !== undefined) patch.contactPhone = data.contactPhone?.trim() || null;
    if (data.commissionRateOverride !== undefined) patch.commissionRateOverride = data.commissionRateOverride;
    if (data.expectedBranchCount !== undefined) patch.expectedBranchCount = data.expectedBranchCount;
    if (data.negotiationNotes !== undefined) patch.negotiationNotes = data.negotiationNotes?.trim() || null;

    return partnerRepository.updatePartner(partnerId, patch);
  },

  /**
   * Phase 2 — "Chuyển quyền sở hữu". ⚠️ KHÔNG BAO GIỜ là bàn giao mật khẩu: hai tài khoản
   * đổi chỗ thuộc tính `role` cho nhau, mỗi người vẫn giữ nguyên thông tin đăng nhập của
   * mình.
   *
   * Ba việc phải xảy ra cùng một lúc, nếu không hỏng nửa chừng là hỏng nặng:
   *
   *  1. Hạ chủ cũ xuống MANAGER **trước**, rồi mới nâng người mới lên OWNER — partial
   *     unique index "đúng một OWNER đang hoạt động" từ chối nếu làm ngược lại, kể cả bên
   *     trong một giao dịch (Postgres kiểm unique index theo từng câu lệnh).
   *  2. Chủ cũ nhận đúng phạm vi chi nhánh mà người mới đang có — CHECK constraint bắt
   *     MANAGER phải có ít nhất một chi nhánh, và đây mới thật sự là "đổi chỗ": cả vai trò
   *     lẫn phạm vi đều hoán đổi.
   *  3. Ghi lại Gym.ownerId và GymBrand.ownerId sang userId mới. Đây là bước dễ quên nhất
   *     và hỏng âm thầm nhất: bỏ qua thì chủ mới đăng nhập vào thấy trống trơn, còn các
   *     truy vấn quyền sở hữu vẫn trỏ về một người không còn là chủ nữa.
   */
  async transferOwnership(partnerId: string, toAccountId: string, adminId: string) {
    const partner = await partnerRepository.findPartnerById(partnerId);
    if (!partner) throw err('Không tìm thấy đối tác', 404);

    const currentOwner = await partnerRepository.findActiveOwnerAccount(partnerId);
    if (!currentOwner) throw err('Đối tác này chưa có chủ sở hữu đang hoạt động', 409);

    const target = await partnerRepository.findAccountById(toAccountId);
    if (!target) throw err('Không tìm thấy tài khoản nhận quyền', 404);
    if (target.partnerId !== partnerId) throw err('Tài khoản này không thuộc đối tác đã chọn', 403);
    if (target.status !== 'ACTIVE') throw err('Chỉ chuyển quyền cho tài khoản đang hoạt động', 409);
    if (target.id === currentOwner.id) throw err('Tài khoản này đã là chủ sở hữu', 409);

    const inheritedScope = target.scopedGymIds.length > 0 ? target.scopedGymIds : [];
    if (inheritedScope.length === 0) {
      throw err('Tài khoản nhận quyền chưa được gán chi nhánh nào — không có phạm vi để chủ cũ kế thừa', 409);
    }

    const { prisma } = await import('../repositories/prisma');
    const result = await prisma.$transaction(async (tx) => {
      // (1) + (2) — hạ chủ cũ trước, kế thừa phạm vi của người sắp lên.
      await tx.gymPartnerAccount.update({
        where: { id: currentOwner.id },
        data: { role: 'MANAGER', scopedGymIds: inheritedScope },
      });
      const promoted = await tx.gymPartnerAccount.update({
        where: { id: target.id },
        data: { role: 'OWNER', scopedGymIds: [] },
      });

      // (3) — chuyển quyền sở hữu dữ liệu sang userId mới.
      const gyms = await tx.gym.updateMany({
        where: { ownerId: currentOwner.userId },
        data: { ownerId: target.userId },
      });
      const brands = await tx.gymBrand.updateMany({
        where: { ownerId: currentOwner.userId },
        data: { ownerId: target.userId },
      });

      return { promoted, gymsMoved: gyms.count, brandsMoved: brands.count };
    });

    logger.info(
      `[Partner] ${adminId} transferred ownership of ${partnerId}: ${currentOwner.userId} -> ${target.userId} (${result.gymsMoved} gyms, ${result.brandsMoved} brands)`,
    );
    return { ...result, previousOwnerAccountId: currentOwner.id };
  },

  /**
   * Kiểm chứng dữ liệu: userId của chủ sở hữu đang hoạt động phải đúng là userId mà các
   * chi nhánh/thương hiệu của đối tác đó đang khoá theo. Lệch nhau nghĩa là một lần
   * chuyển quyền sở hữu đã quên viết lại cột ownerId — hỏng âm thầm, nên phải có chỗ
   * phát hiện được thay vì chờ chủ mới báo "tôi không thấy chi nhánh nào".
   */
  async assertOwnershipConsistent(partnerId: string) {
    const owner = await partnerRepository.findActiveOwnerAccount(partnerId);
    if (!owner) return { consistent: false, reason: 'Đối tác không có chủ sở hữu đang hoạt động' as const };

    const partner = await partnerRepository.findPartnerById(partnerId);
    if (!partner?.brandId) return { consistent: true as const, reason: null };

    const { brandRepository } = await import('../repositories/brand.repository');
    const brand = await brandRepository.findById(partner.brandId);
    if (brand && brand.ownerId !== owner.userId) {
      return {
        consistent: false as const,
        reason: `Thương hiệu ${partner.brandId} đang khoá theo ${brand.ownerId} nhưng chủ sở hữu hiện tại là ${owner.userId}`,
      };
    }
    return { consistent: true as const, reason: null };
  },

  // ── Phase 5 — tạm khoá / bỏ tạm khoá ──────────────────────────────────────
  /**
   * Tạm khoá TÀI KHOẢN OWNER, không phải toàn bộ đối tác — bảng hệ quả 5.1: quản lý chi
   * nhánh (MANAGER) vẫn hoạt động bình thường ("cần người phục vụ hội viên còn hạn"), chỉ
   * chủ sở hữu không đăng nhập được. Mọi hệ quả khác (ngừng bán mới, đóng băng rút tiền,
   * ẩn khỏi tìm kiếm) đều đọc thẳng `partner.status` ở nơi cần (partnerGuard, gym.service),
   * không có gì phải làm thêm ở đây ngoài đổi status + khoá đăng nhập của OWNER.
   */
  async suspend(partnerId: string, adminId: string, reason: string) {
    if (!reason?.trim()) throw err('Lý do tạm khoá là bắt buộc', 400);
    const partner = await partnerRepository.findPartnerById(partnerId);
    if (!partner) throw err('Không tìm thấy đối tác', 404);
    if (partner.status !== 'ACTIVE') throw err('Chỉ tạm khoá được đối tác đang hoạt động', 409);

    const owner = await partnerRepository.findActiveOwnerAccount(partnerId);
    const updated = await partnerRepository.updatePartner(partnerId, {
      status: 'SUSPENDED',
      suspendedAt: new Date(),
      suspendedReason: reason.trim(),
      suspendedBy: adminId,
    });

    if (owner) {
      const { authClient } = await import('../clients/auth.client');
      await authClient.setUserActive(owner.userId, false, adminId, reason).catch((e) =>
        logger.error({ err: e.message, partnerId }, '[Partner] khoá đăng nhập OWNER thất bại khi tạm khoá đối tác'),
      );
    }

    logger.info(`[Partner] ${adminId} suspended ${partnerId}: ${reason}`);
    return updated;
  },

  async unsuspend(partnerId: string, adminId: string) {
    const partner = await partnerRepository.findPartnerById(partnerId);
    if (!partner) throw err('Không tìm thấy đối tác', 404);
    if (partner.status !== 'SUSPENDED') throw err('Đối tác này hiện không bị tạm khoá', 409);

    const owner = await partnerRepository.findActiveOwnerAccount(partnerId);
    const updated = await partnerRepository.updatePartner(partnerId, {
      status: 'ACTIVE',
      suspendedAt: null,
      suspendedReason: null,
      suspendedBy: null,
    });

    if (owner) {
      const { authClient } = await import('../clients/auth.client');
      await authClient.setUserActive(owner.userId, true, adminId).catch((e) =>
        logger.error({ err: e.message, partnerId }, '[Partner] mở khoá đăng nhập OWNER thất bại khi bỏ tạm khoá đối tác'),
      );
    }

    logger.info(`[Partner] ${adminId} unsuspended ${partnerId}`);
    return updated;
  },

  // ── Phase 5 — chấm dứt hợp tác ────────────────────────────────────────────
  /**
   * Đếm trước khi cho admin xác nhận — đặc tả 5.2: "không được để admin bấm chấm dứt mà
   * không biết mình đang ảnh hưởng tới bao nhiêu người". Mọi cuộc gọi phụ (đếm hợp đồng
   * PT ở user-service, số dư ví ở payment-service) đều dùng best-effort: một dịch vụ khác
   * đang chậm/lỗi không được chặn màn hình cảnh báo hiện ra — thà thiếu một con số còn hơn
   * chặn đứng luôn hành động.
   */
  async terminationImpact(partnerId: string) {
    const partner = await partnerRepository.findPartnerById(partnerId);
    if (!partner) throw err('Không tìm thấy đối tác', 404);
    const owner = await partnerRepository.findActiveOwnerAccount(partnerId);

    const { gymRepository } = await import('../repositories/gym.repository');
    const gyms = owner ? await gymRepository.findByOwner(owner.userId) : [];
    const gymIds = gyms.map((g) => g.id);

    const { membershipRepository } = await import('../repositories/membership.repository');
    const { membershipService } = await import('./membership.service');
    const { userClient } = await import('../clients/user.client');
    const { paymentClient } = await import('../clients/payment.client');

    const [activeMemberships, activePtContracts, wallets] = await Promise.all([
      membershipRepository.findActiveByGyms(gymIds),
      userClient.countActivePtContractsByGyms(gymIds),
      Promise.all(gyms.map((g) => paymentClient.getWallet('GYM', g.id).catch(() => null))),
    ]);

    const unusedValueTotal = activeMemberships.reduce(
      (sum, m) => sum + membershipService.quoteRefund(m as any).refundAmount,
      0,
    );
    const walletBalanceTotal = wallets.reduce(
      (sum, w) => sum + Number(w?.availableBalance ?? 0) + Number(w?.pendingBalance ?? 0),
      0,
    );

    return {
      activeGyms: gyms.filter((g) => g.status === 'APPROVED').length,
      totalGyms: gyms.length,
      activeMembers: activeMemberships.length,
      unusedValueTotal,
      activePtContracts,
      walletBalanceTotal,
    };
  },

  /**
   * Chấm dứt hợp tác — không quay lại được. `memberPolicy` bắt buộc chọn:
   *  - SERVE_UNTIL_EXPIRY: không đụng gì tới hội viên đang ACTIVE, chỉ khoá bán mới (đã tự
   *    xảy ra vì partnerGuard đọc thấy status=TERMINATED).
   *  - PRORATED_REFUND: hoàn tiền phần chưa dùng cho từng hội viên ACTIVE — TÁI SỬ DỤNG
   *    nguyên xi membershipService.refundByAdmin (lý do GYM_CLOSED, gần nghĩa nhất trong 3
   *    lý do sẵn có: đối tác rời nền tảng ≈ mọi chi nhánh của họ đóng cửa với nền tảng này)
   *    thay vì tự chế công thức hoàn tiền mới — đúng ràng buộc "không đổi công thức chia
   *    tiền hiện có". Một hội viên hoàn lỗi không chặn các hội viên còn lại; lỗi được gom
   *    lại trả về để admin biết còn ai cần xử lý tay.
   */
  async terminate(
    partnerId: string,
    adminId: string,
    reason: string,
    memberPolicy: 'SERVE_UNTIL_EXPIRY' | 'PRORATED_REFUND',
  ) {
    if (!reason?.trim()) throw err('Lý do chấm dứt là bắt buộc', 400);
    if (memberPolicy !== 'SERVE_UNTIL_EXPIRY' && memberPolicy !== 'PRORATED_REFUND') {
      throw err('Phải chọn cách xử lý hội viên còn hạn', 400);
    }
    const partner = await partnerRepository.findPartnerById(partnerId);
    if (!partner) throw err('Không tìm thấy đối tác', 404);
    if (partner.status === 'TERMINATED') throw err('Đối tác này đã chấm dứt hợp tác từ trước', 409);

    const owner = await partnerRepository.findActiveOwnerAccount(partnerId);

    // Đổi status TRƯỚC — mọi lệnh mua mới bắn ra trong lúc đang hoàn tiền hàng loạt (dù
    // hiếm) đều bị partnerGuard chặn ngay từ giây này.
    const updated = await partnerRepository.updatePartner(partnerId, {
      status: 'TERMINATED',
      terminatedAt: new Date(),
      terminationReason: reason.trim(),
      terminationMemberPolicy: memberPolicy,
    });

    let refunded = 0;
    const refundErrors: { membershipId: string; message: string }[] = [];
    if (memberPolicy === 'PRORATED_REFUND') {
      const { gymRepository } = await import('../repositories/gym.repository');
      const { membershipRepository } = await import('../repositories/membership.repository');
      const { membershipService } = await import('./membership.service');

      const gyms = owner ? await gymRepository.findByOwner(owner.userId) : [];
      const memberships = await membershipRepository.findActiveByGyms(gyms.map((g) => g.id));
      for (const m of memberships) {
        try {
          await membershipService.refundByAdmin(m.id, adminId, 'GYM_CLOSED');
          refunded += 1;
        } catch (e: any) {
          refundErrors.push({ membershipId: m.id, message: e.message });
          logger.error({ err: e.message, membershipId: m.id }, '[Partner] hoàn tiền hội viên lúc chấm dứt đối tác thất bại');
        }
      }
    }

    // Khoá đăng nhập của MỌI tài khoản (OWNER lẫn MANAGER) — khác tạm khoá (chỉ OWNER),
    // vì chấm dứt là vĩnh viễn, không còn "quản lý chi nhánh giúp trong lúc chờ" nào nữa.
    const { authClient } = await import('../clients/auth.client');
    const accounts = await partnerRepository.listAccountsByPartner(partnerId);
    await Promise.all(
      accounts
        .filter((a) => a.status === 'ACTIVE')
        .map((a) =>
          authClient
            .setUserActive(a.userId, false, adminId, reason)
            .catch((e) => logger.error({ err: e.message, accountId: a.id }, '[Partner] khoá đăng nhập thất bại lúc chấm dứt')),
        ),
    );

    logger.info(`[Partner] ${adminId} terminated ${partnerId} (policy=${memberPolicy}, refunded=${refunded}): ${reason}`);
    return { partner: updated, refunded, refundErrors };
  },
};
