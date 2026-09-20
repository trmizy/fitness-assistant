import { Request, Response } from 'express';
import { onboardingService } from '../services/onboarding.service';
import { principalId } from '../middleware/partner-context.middleware';

function fail(res: Response, e: any) {
  res.status(e.status || 500).json({ success: false, error: { message: e.message || 'Đã có lỗi xảy ra' } });
}

/** Mọi handler ở đây đọc `req.partner!.accountId` trực tiếp — KHÔNG qua principalId() —
 * vì onboarding là việc của CHÍNH tài khoản đang đăng nhập (quản lý tự làm cho mình,
 * không mượn danh chủ sở hữu như các route quản lý dữ liệu khác). */
export const onboardingController = {
  async status(req: Request, res: Response) {
    // Chủ gym có từ trước Phase 3 (không có hồ sơ đối tác — `accountId` null) không có
    // trình thiết lập nào để hoàn tất. Không có guard này thì tra cứu accountId=null rơi
    // xuống Prisma và ném lỗi 500 thô, thay vì "đã xong".
    //
    // CHỈ dành cho chủ gym cũ CHỨNG MINH ĐƯỢC (isLegacy). Một ngữ cảnh không-account mà không
    // phải legacy (tài khoản GYM_OWNER mồ côi) không bao giờ tới được đây — route đứng sau
    // requirePartnerAccountOrLegacy — và tuyệt đối không được nhận "đã xong hết".
    if (req.partner!.isLegacy) {
      res.json({
        success: true,
        data: { role: 'OWNER', steps: { password: true, contact: true, brand: true, payout: true, terms: true }, completed: true, currentStep: 5, partnerId: null },
      });
      return;
    }
    // Phòng thủ: route đứng sau requirePartnerAccountOrLegacy nên tới được đây là phải có account.
    const accountId = req.partner!.accountId;
    if (!accountId) {
      res.status(403).json({
        success: false,
        error: { code: 'NO_PARTNER_ACCOUNT', message: 'Tài khoản này chưa có hồ sơ đối tác' },
      });
      return;
    }
    try {
      const progress = await onboardingService.getProgress(accountId);
      res.json({ success: true, data: progress });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async submitContact(req: Request, res: Response) {
    try {
      const progress = await onboardingService.submitContact(req.partner!.accountId!, req.body?.phone);
      res.json({ success: true, data: progress });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async submitBrand(req: Request, res: Response) {
    try {
      if (req.partner!.role !== 'OWNER') throw Object.assign(new Error('Chỉ chủ sở hữu đặt tên thương hiệu'), { status: 403 });
      const progress = await onboardingService.submitBrand(
        req.partner!.accountId!,
        principalId(req),
        req.partner!.partnerId!,
        req.body ?? {},
      );
      res.json({ success: true, data: progress });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async submitPayout(req: Request, res: Response) {
    try {
      if (req.partner!.role !== 'OWNER') throw Object.assign(new Error('Chỉ chủ sở hữu nhập thông tin nhận tiền'), { status: 403 });
      const progress = await onboardingService.submitPayout(req.partner!.accountId!, req.partner!.partnerId!, req.body ?? {});
      res.json({ success: true, data: progress });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async submitTerms(req: Request, res: Response) {
    try {
      if (req.partner!.role !== 'OWNER') throw Object.assign(new Error('Chỉ chủ sở hữu chấp nhận điều khoản'), { status: 403 });
      const progress = await onboardingService.submitTerms(req.partner!.accountId!, req.partner!.partnerId!, req.body?.version);
      res.json({ success: true, data: progress });
    } catch (e: any) {
      fail(res, e);
    }
  },
};
