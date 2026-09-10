import type { Request } from 'express';
import { logger } from '@gym-coach/shared';
import { prisma } from '../repositories/prisma';
import type { PartnerAuditAction } from '../generated/prisma';

/**
 * Phase 2 mục 2.4 — nhật ký kiểm toán bắt buộc.
 *
 * Ghi: ai (adminUserId) · làm gì · lên đối tác/tài khoản nào · lúc nào · lý do · IP.
 *
 * Bắt buộc với: cấp tài khoản, tạm khoá, chấm dứt, đặt lại mật khẩu, chuyển quyền sở hữu,
 * và **xem dưới góc nhìn đối tác** — mục cuối quan trọng nhất: không ghi nhật ký thì nó là
 * một cửa hậu.
 */
export const partnerAuditService = {
  /**
   * Ghi nhật ký không bao giờ làm hỏng hành động chính. Một hành động quản trị đã thực hiện
   * xong rồi mà ném lỗi vì không ghi được nhật ký thì để lại đúng thứ tệ nhất: thay đổi có
   * thật, phía gọi tưởng thất bại, và vẫn không có dòng nhật ký nào. Ghi hỏng thì hét vào
   * log ứng dụng — chỗ đó có cảnh báo.
   */
  async record(params: {
    partnerId: string;
    actorUserId: string;
    action: PartnerAuditAction;
    targetAccountId?: string | null;
    reason?: string | null;
    req?: Request;
    metadata?: Record<string, unknown>;
  }) {
    try {
      return await prisma.partnerAuditLog.create({
        data: {
          partnerId: params.partnerId,
          actorUserId: params.actorUserId,
          action: params.action,
          targetAccountId: params.targetAccountId ?? null,
          reason: params.reason ?? null,
          ipAddress: params.req ? clientIp(params.req) : null,
          userAgent: params.req?.get('user-agent') ?? null,
          metadata: (params.metadata ?? undefined) as any,
        },
      });
    } catch (e) {
      logger.error(
        { err: (e as Error).message, action: params.action, partnerId: params.partnerId, actor: params.actorUserId },
        '[PartnerAudit] KHÔNG ghi được nhật ký kiểm toán — hành động vẫn đã thực hiện',
      );
      return null;
    }
  },

  listForPartner(partnerId: string, limit = 200) {
    return prisma.partnerAuditLog.findMany({
      where: { partnerId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },
};

/**
 * IP thật của người gọi. Mọi yêu cầu tới đây đều đi qua gateway nên req.ip là IP của
 * gateway — x-forwarded-for mới là của trình duyệt quản trị viên. Lấy phần tử đầu tiên
 * (chuỗi proxy nối thêm về sau).
 */
function clientIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (raw) return raw.split(',')[0].trim();
  return req.ip ?? req.socket?.remoteAddress ?? null;
}
