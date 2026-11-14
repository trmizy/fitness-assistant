import crypto from 'crypto';
import { logger } from '@gym-coach/shared';
import { partnerRepository } from '../repositories/partner.repository';
import { prisma } from '../repositories/prisma';
import { authClient } from '../clients/auth.client';
import type { PartnerAccountRole } from '../generated/prisma';
import { roleRequiresBranchScope } from './partner-permissions';

function err(message: string, status: number, code?: string) {
  return Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

/** Định dạng email tối thiểu: có phần tên, một @, tên miền có dấu chấm và đuôi >= 2 ký tự, không khoảng trắng. */
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/;
export function isValidInviteEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_RE.test(email);
}

type InviteDb = Pick<typeof prisma, 'partnerInvitation'>;

/**
 * B10 - một email chỉ nên có MỘT lời mời nhân sự còn sống, và không mời lại người đã là thành viên:
 *   - đã có thư mời ĐÃ CHẤP NHẬN cho email này => tài khoản đăng nhập đã tồn tại (auth-service từ chối tạo lần hai):
 *     cùng đối tác => ALREADY_PARTNER_MEMBER, đối tác khác => EMAIL_IN_USE (không tiết lộ đó là đối tác nào);
 *   - đã có thư mời đang CHỜ còn hạn của cùng đối tác => INVITATION_ALREADY_PENDING (dùng "Gửi lại" thay vì mời thêm);
 *   - thư mời chờ đã quá hạn thì đánh dấu EXPIRED rồi cho mời mới.
 * Email thuộc tài khoản khách/PT/admin (không phải nhân sự đối tác) gym-service KHÔNG tự biết được - auth-service
 * từ chối ở bước nhận lời mời (409 EMAIL_IN_USE, xem public-partner.controller.ts).
 */
export async function assertEmailInvitable(
  db: InviteDb,
  partnerId: string,
  email: string,
  /** Q4 (14/11): người này từng là nhân sự của CHÍNH đối tác nhưng quyền đã bị thu hồi (REVOKED) => được mời lại. */
  opts: { revokedMember?: boolean } = {},
): Promise<void> {
  const rows = await db.partnerInvitation.findMany({ where: { email, status: { in: ['PENDING', 'ACCEPTED'] } } });
  const accepted = rows.filter((r) => r.status === 'ACCEPTED');
  if (accepted.some((r) => r.partnerId === partnerId) && !opts.revokedMember) {
    throw err('Email này đã là thành viên trong đối tác của bạn', 409, 'ALREADY_PARTNER_MEMBER');
  }
  if (accepted.some((r) => r.partnerId !== partnerId)) {
    throw err('Email này đã có tài khoản Gymini — hãy mời bằng một email khác', 409, 'EMAIL_IN_USE');
  }
  const now = Date.now();
  const mine = rows.filter((r) => r.status === 'PENDING' && r.partnerId === partnerId);
  if (mine.some((r) => r.expiresAt.getTime() > now)) {
    throw err('Đã có lời mời đang chờ cho email này — hãy dùng "Gửi lại" nếu người nhận chưa thấy thư', 409, 'INVITATION_ALREADY_PENDING');
  }
  const stale = mine.filter((r) => r.expiresAt.getTime() <= now).map((r) => r.id);
  if (stale.length > 0) await db.partnerInvitation.updateMany({ where: { id: { in: stale } }, data: { status: 'EXPIRED' } });
}

const DEFAULT_TTL_DAYS = 7;

/**
 * Q4 (14/11) - tìm tài khoản nhân sự ĐÃ BỊ THU HỒI của đối tác này ứng với một email. gym-service không lưu email của tài
 * khoản đăng nhập nên hỏi auth-service theo lô các tài khoản REVOKED của đối tác (số lượng nhỏ) rồi so email.
 * Không hỏi được auth-service => null (bảo thủ: vẫn coi là "đã là thành viên", không tự ý cho mời lại).
 */
export async function findRevokedAccountByEmail(partnerId: string, email: string) {
  const revoked = (await partnerRepository.listAccountsByPartner(partnerId)).filter((a) => a.status === 'REVOKED');
  if (revoked.length === 0) return null;
  try {
    const users = await authClient.getUsersBatch(revoked.map((a) => a.userId));
    const wanted = email.trim().toLowerCase();
    const hit = users.find((u) => u.email?.trim().toLowerCase() === wanted);
    return hit ? (revoked.find((a) => a.userId === hit.id) ?? null) : null;
  } catch (e) {
    logger.warn({ err: (e as Error).message, partnerId }, '[PartnerInvitation] không tra được email của tài khoản đã thu hồi - coi như chưa thu hồi');
    return null;
  }
}

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
    /** Mời nhân sự (B10): kiểm email hợp lệ + không trùng lời mời/thành viên, tuần tự hoá theo đối tác. */
    enforceUniqueEmail?: boolean;
  }) {
    const email = params.email?.trim().toLowerCase();
    if (!email) throw err('Email là bắt buộc', 400, 'EMAIL_REQUIRED');
    if (params.enforceUniqueEmail && !isValidInviteEmail(email)) {
      throw err('Email không hợp lệ — hãy nhập đúng dạng ten@congty.vn', 400, 'INVALID_EMAIL');
    }

    const partner = await partnerRepository.findPartnerById(params.partnerId);
    if (!partner) throw err('Không tìm thấy đối tác', 404);
    if (partner.status === 'TERMINATED') throw err('Đối tác đã chấm dứt hợp tác', 409);

    const scopedGymIds = params.scopedGymIds ?? [];
    // Cùng bất biến với GymPartnerAccount (CHECK constraint ở CSDL): một quản lý không
    // được gán chi nhánh nào là tài khoản đăng nhập được mà chẳng làm được gì.
    if (roleRequiresBranchScope(params.role) && scopedGymIds.length === 0) {
      throw err('Tài khoản quản lý/lễ tân phải được gán ít nhất một chi nhánh', 400);
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

    const data = {
      partnerId: params.partnerId,
      email,
      role: params.role,
      scopedGymIds,
      tokenHash: hashToken(rawToken),
      expiresAt,
      createdBy: params.createdBy,
    };
    if (params.enforceUniqueEmail) {
      // B10: an email that already belongs to a customer / PT / admin account can never accept a partner invitation.
      // GYM_OWNER accounts are covered by assertEmailInvitable (partner membership). auth-service down => not blocked.
      const status = await authClient.emailStatus(email);
      if (status?.exists && status.role !== 'GYM_OWNER') {
        throw err('Email này đã được dùng cho một tài khoản Gymini khác — hãy mời bằng một email khác', 409, 'EMAIL_IN_USE');
      }
    }
    const revokedMember = params.enforceUniqueEmail ? Boolean(await findRevokedAccountByEmail(params.partnerId, email)) : false;
    const invitation = params.enforceUniqueEmail
      ? await prisma.$transaction(async (tx) => {
          // Khoá dòng đối tác: hai lần bấm "Mời" cùng lúc không thể cùng lọt qua bước kiểm trùng.
          await tx.$queryRaw`SELECT id FROM gym_partners WHERE id = ${params.partnerId} FOR UPDATE`;
          await assertEmailInvitable(tx, params.partnerId, email, { revokedMember });
          return tx.partnerInvitation.create({ data });
        })
      : await partnerRepository.createInvitation(data);

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
      // Q4 (14/11): người từng bị thu hồi của CHÍNH đối tác này nhận lời mời mới => kích hoạt lại đúng bản ghi cũ.
      if (existingAccount.partnerId === invitation.partnerId && existingAccount.status === 'REVOKED') {
        return this.reactivateRevokedAccount(invitation, existingAccount);
      }
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

  /**
   * Q4 (14/11) - kích hoạt lại tài khoản nhân sự đã bị thu hồi bằng lời mời MỚI: cùng một hàng gym_partner_accounts (cùng
   * userId, giữ onboarding), vai trò + phạm vi chi nhánh lấy theo lời mời mới. Lời mời ACCEPTED cũ giữ nguyên làm lịch sử;
   * thông tin thu hồi cũ (thời điểm/lý do/vai trò cũ) được ghi vào nhật ký kiểm toán trong CÙNG transaction.
   * Một lời mời chỉ dùng được một lần: chuyển PENDING -> ACCEPTED có điều kiện, hai lần bấm đồng thời chỉ một lần thắng.
   */
  async reactivateRevokedAccount(
    invitation: NonNullable<Awaited<ReturnType<typeof partnerRepository.findInvitationByTokenHash>>>,
    account: NonNullable<Awaited<ReturnType<typeof partnerRepository.findAccountByUserId>>>,
  ) {
    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.partnerInvitation.updateMany({
        where: { id: invitation.id, status: 'PENDING' },
        data: { status: 'ACCEPTED', acceptedAt: now },
      });
      if (claimed.count !== 1) throw err('Thư mời này đã được sử dụng', 409);
      const next = await tx.gymPartnerAccount.updateMany({
        where: { id: account.id, status: 'REVOKED' },
        data: {
          status: 'ACTIVE',
          role: invitation.role,
          scopedGymIds: invitation.scopedGymIds,
          invitedBy: invitation.createdBy,
          invitedAt: invitation.createdAt,
          activatedAt: now,
          revokedAt: null,
          revokedReason: null,
        },
      });
      if (next.count !== 1) throw err('Tài khoản này không còn ở trạng thái bị thu hồi', 409);
      await tx.partnerAuditLog.create({
        data: {
          partnerId: invitation.partnerId,
          actorUserId: account.userId,
          action: 'PARTNER_UPDATED',
          targetAccountId: account.id,
          reason: 'Kích hoạt lại nhân sự đã bị thu hồi bằng lời mời mới',
          metadata: {
            reactivated: true,
            invitationId: invitation.id,
            previousRole: account.role,
            previousScopedGymIds: account.scopedGymIds,
            previousRevokedAt: account.revokedAt?.toISOString() ?? null,
            previousRevokedReason: account.revokedReason,
            newRole: invitation.role,
            newScopedGymIds: invitation.scopedGymIds,
          } as any,
        },
      });
      return tx.gymPartnerAccount.findUniqueOrThrow({ where: { id: account.id } });
    });
    logger.info(`[PartnerInvitation] ${account.userId} re-activated revoked account ${account.id} via invitation ${invitation.id} as ${invitation.role}`);
    return updated;
  },

  /** Q4 - lời mời này có phải để kích hoạt lại một nhân sự đã bị thu hồi của chính đối tác không? (trả về tài khoản cũ hoặc null) */
  async findReactivationTarget(invitation: { partnerId: string; email: string }) {
    return findRevokedAccountByEmail(invitation.partnerId, invitation.email);
  },

  listForPartner(partnerId: string) {
    return partnerRepository.listInvitationsByPartner(partnerId);
  },

  /** Chỉ dùng trong kiểm thử/quản trị — băm cùng thuật toán với lúc tạo. */
  _hashToken: hashToken,
};
