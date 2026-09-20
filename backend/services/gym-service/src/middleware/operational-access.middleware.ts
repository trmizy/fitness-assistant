import { Request, Response, NextFunction } from 'express';
import { evaluateOperationalAccess } from '../services/partner-access.policy';
import { onboardingService } from '../services/onboarding.service';
import { resolvePartnerContext } from './partner-context.middleware';

/**
 * Cổng vận hành — bọc quanh `evaluateOperationalAccess` (partner-access.policy.ts), nơi chứa toàn
 * bộ quy tắc. Đặt SAU resolvePartnerContext và TRƯỚC mọi route vận hành của /owner; các route
 * dành cho ứng viên (`/application/*`, `/onboarding/*`) phải mount TRƯỚC điểm này.
 *
 * Thay thế `requireOnboardingComplete` cũ — thứ cho qua vô điều kiện mọi ngữ cảnh `isLegacy` hoặc
 * không có `accountId`, tức là cho cả tài khoản GYM_OWNER mồ côi lẫn ứng viên đi tắt qua.
 */
export async function requireOperationalAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  const ctx = req.partner;
  if (!ctx) {
    res.status(500).json({
      success: false,
      error: { code: 'PARTNER_CONTEXT_MISSING', message: 'resolvePartnerContext chưa chạy' },
    });
    return;
  }

  const decision = evaluateOperationalAccess(ctx);
  if (decision.allowed) {
    next();
    return;
  }

  if (decision.code === 'ONBOARDING_INCOMPLETE') {
    try {
      // Kèm tiến độ chi tiết để frontend biết đang dở bước nào (chủ vừa được duyệt: còn payout).
      const progress = ctx.accountId ? await onboardingService.getProgress(ctx.accountId) : undefined;
      res.status(409).json({
        success: false,
        error: { code: decision.code, message: decision.message },
        data: progress,
      });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
    return;
  }

  res.status(decision.status).json({
    success: false,
    error: { code: decision.code, message: decision.message },
  });
}

/**
 * Các route `/onboarding/*` đọc/ghi CHÍNH tài khoản đối tác của người đang gọi — chưa có tài khoản
 * thì không có gì để đọc. Trước đây một ngữ cảnh không-account được coi như "đã xong hết".
 */
export function requirePartnerAccountOrLegacy(req: Request, res: Response, next: NextFunction): void {
  const ctx = req.partner;
  if (ctx && (ctx.isLegacy || ctx.accountId)) {
    next();
    return;
  }
  res.status(403).json({
    success: false,
    error: {
      code: 'NO_PARTNER_ACCOUNT',
      message: 'Tài khoản này chưa có hồ sơ đối tác — hãy hoàn tất đăng ký đối tác trước',
    },
  });
}

/**
 * Cho route dùng chung nhiều vai trò nhưng có nhánh dành cho chủ gym (vd `/me/collaborations`,
 * PT + GYM_OWNER, nằm NGOÀI `/owner` nên không đi qua cổng ở owner.routes.ts): chỉ khi người gọi là
 * GYM_OWNER mới đòi ngữ cảnh + cổng vận hành; vai trò khác đi tiếp như cũ.
 */
export async function requireOperationalAccessForOwners(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.user?.role !== 'GYM_OWNER') {
    next();
    return;
  }
  await resolvePartnerContext(req, res, () => {
    void requireOperationalAccess(req, res, next);
  });
}
