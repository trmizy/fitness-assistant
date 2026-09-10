import crypto from 'crypto';
import { logger } from '@gym-coach/shared';
import { partnerRepository } from '../repositories/partner.repository';
import type { PartnerAccountRole } from '../generated/prisma';

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

const DEFAULT_TTL_DAYS = 7;

/**
 * ⚠️ Token gốc KHÔNG BAO GIỜ được lưu. Sinh ra 32 byte ngẫu nhiên, trả bản gốc đúng một
 * lần cho phía gọi (để nhét vào link trong email), lưu sha256 của nó. Ai đọc được CSDL
 * cũng không nhận được thư mời của người khác.
 *
 * sha256 trần (không bcrypt/argon) là đúng ở đây và khác hẳn trường hợp mật khẩu: đây là
 * bí mật 256-bit hệ thống tự sinh, không phải chuỗi người tự nghĩ ra — không có từ điển
 * nào để dò, nên chi phí băm chậm chẳng bảo vệ thêm được gì, trong khi lại phải quét
 * toàn bảng để so từng dòng (bcrypt không tra cứu bằng index được).
 */
function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export const partnerInvitationService = {
  /**
   * Tạo thư mời. Trả về `rawToken` — lần duy nhất giá trị này tồn tại; phía gọi phải gửi
   * ngay và không lưu lại ở đâu.
   */
  async createInvitation(params: {
    partnerId: string;
    email: string;
    role: PartnerAccountRole;
    scopedGymIds?: string[];
    createdBy: string;
    ttlDays?: number;
  }) {
    const email = params.email?.trim().toLowerCase();
    if (!email) throw err('Email là bắt buộc', 400);

    const partner = await partnerRepository.findPartnerById(params.partnerId);
    if (!partner) throw err('Không tìm thấy đối tác', 404);
    if (partner.status === 'TERMINATED') throw err('Đối tác đã chấm dứt hợp tác', 409);

    const scopedGymIds = params.scopedGymIds ?? [];
    // Cùng bất biến với GymPartnerAccount (CHECK constraint ở CSDL): một quản lý không
    // được gán chi nhánh nào là tài khoản đăng nhập được mà chẳng làm được gì.
    if (params.role === 'MANAGER' && scopedGymIds.length === 0) {
      throw err('Người quản lý phải được gán ít nhất một chi nhánh', 400);
    }
    // Mời thêm OWNER thứ hai là vô nghĩa: bất biến "đúng một OWNER đang hoạt động" sẽ
    // chặn lúc chấp nhận, tức là người được mời bấm vào link rồi mới báo lỗi.
    if (params.role === 'OWNER') {
      const activeOwners = await partnerRepository.countActiveOwners(params.partnerId);
      if (activeOwners > 0) {
        throw err('Đối tác này đã có chủ sở hữu — hãy dùng chức năng chuyển quyền sở hữu', 409);
      }
    }

    const rawToken = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + (params.ttlDays ?? DEFAULT_TTL_DAYS) * 24 * 60 * 60 * 1000);

    const invitation = await partnerRepository.createInvitation({
      partnerId: params.partnerId,
      email,
      role: params.role,
      scopedGymIds,
      tokenHash: hashToken(rawToken),
      expiresAt,
      createdBy: params.createdBy,
    });

    logger.info(`[PartnerInvitation] ${params.createdBy} invited ${email} as ${params.role} to partner ${params.partnerId}`);
    return { invitation, rawToken };
  },

  /**
   * Gửi lại: thư cũ hết hiệu lực ngay (REVOKED), thư mới có token mới hoàn toàn.
   * Không gia hạn thư cũ — link cũ đã nằm trong hộp thư ai đó, kéo dài hạn của nó là
   * kéo dài luôn thời gian sống của một credential có thể đã rò rỉ.
   */
  async resendInvitation(invitationId: string, resentBy: string) {
    const existing = await partnerRepository.findInvitationById(invitationId);
    if (!existing) throw err('Không tìm thấy thư mời', 404);
    if (existing.status === 'ACCEPTED') throw err('Thư mời này đã được chấp nhận', 409);

    await partnerRepository.revokePendingInvitations(existing.partnerId, existing.email);

    const rawToken = crypto.randomBytes(32).toString('base64url');
    const invitation = await partnerRepository.createInvitation({
      partnerId: existing.partnerId,
      email: existing.email,
      role: existing.role,
      scopedGymIds: existing.scopedGymIds,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000),
      createdBy: resentBy,
      sentCount: existing.sentCount + 1,
    });

    return { invitation, rawToken };
  },

  async revokeInvitation(invitationId: string, revokedBy: string) {
    const existing = await partnerRepository.findInvitationById(invitationId);
    if (!existing) throw err('Không tìm thấy thư mời', 404);
    if (existing.status !== 'PENDING') throw err('Chỉ thu hồi được thư mời đang chờ', 409);
    logger.info(`[PartnerInvitation] ${revokedBy} revoked invitation ${invitationId}`);
    return partnerRepository.updateInvitation(invitationId, { status: 'REVOKED' });
  },

  /**
   * Kiểm tra một token thô. Dùng cho cả màn hình "mở link mời" (hiện thông tin trước khi
   * người dùng đặt mật khẩu) lẫn bước chấp nhận.
   *
   * Thư quá hạn bị đánh dấu EXPIRED ngay lúc chạm tới — không có tác vụ quét định kỳ nào
   * cần thiết cho việc này, và trạng thái trong CSDL không bị nói dối là "PENDING" mãi.
   */
  async validateToken(rawToken: string) {
    if (!rawToken) throw err('Thiếu mã thư mời', 400);
    const invitation = await partnerRepository.findInvitationByTokenHash(hashToken(rawToken));
    if (!invitation) throw err('Thư mời không hợp lệ', 404);

    if (invitation.status === 'ACCEPTED') throw err('Thư mời này đã được sử dụng', 409);
    if (invitation.status === 'REVOKED') throw err('Thư mời này đã bị thu hồi', 409);

    if (invitation.expiresAt.getTime() <= Date.now()) {
      if (invitation.status !== 'EXPIRED') {
        await partnerRepository.updateInvitation(invitation.id, { status: 'EXPIRED' });
      }
      throw err('Thư mời đã hết hạn — hãy đề nghị quản trị viên gửi lại', 410);
    }
    if (invitation.status === 'EXPIRED') throw err('Thư mời đã hết hạn', 410);

    return invitation;
  },

  /**
   * Chấp nhận thư mời: tạo tài khoản đối tác cho `userId` vừa được lập ở auth-service.
   *
   * gym-service KHÔNG chạm tới mật khẩu — phía gọi (Phase 3) lập tài khoản đăng nhập ở
   * auth-service trước rồi đưa userId vào đây. Ranh giới đó cố ý: dịch vụ này không nên
   * có đường nào nhìn thấy credential.
   */
  async acceptInvitation(rawToken: string, userId: string) {
    const invitation = await this.validateToken(rawToken);

    // Bất biến 3 — một userId chỉ thuộc tối đa một đối tác. Unique index đỡ ở CSDL; kiểm
    // ở đây để trả lời được "vì sao" thay vì một lỗi ràng buộc thô.
    const existingAccount = await partnerRepository.findAccountByUserId(userId);
    if (existingAccount) {
      throw err('Tài khoản này đã thuộc về một đối tác khác', 409);
    }

    const account = await partnerRepository.createAccount({
      partnerId: invitation.partnerId,
      userId,
      role: invitation.role,
      scopedGymIds: invitation.scopedGymIds,
      status: 'ACTIVE',
      invitedBy: invitation.createdBy,
      invitedAt: invitation.createdAt,
      activatedAt: new Date(),
    });

    await partnerRepository.updateInvitation(invitation.id, {
      status: 'ACCEPTED',
      acceptedAt: new Date(),
    });

    // Chủ sở hữu nhận thư mời = đối tác chính thức hoạt động. Người quản lý gia nhập
    // không đổi trạng thái đối tác (đối tác đã ACTIVE từ trước rồi).
    if (invitation.role === 'OWNER' && invitation.partner.status === 'INVITED') {
      await partnerRepository.updatePartner(invitation.partnerId, { status: 'ACTIVE' });
    }

    logger.info(`[PartnerInvitation] ${userId} accepted invitation ${invitation.id} as ${invitation.role}`);
    return account;
  },

  listForPartner(partnerId: string) {
    return partnerRepository.listInvitationsByPartner(partnerId);
  },

  /** Chỉ dùng trong kiểm thử/quản trị — băm cùng thuật toán với lúc tạo. */
  _hashToken: hashToken,
};
