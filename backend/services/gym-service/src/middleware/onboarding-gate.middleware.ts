import { Request, Response, NextFunction } from 'express';
import { onboardingService } from '../services/onboarding.service';
import { partnerRepository } from '../repositories/partner.repository';

/**
 * Phase 3 mục 3.1 — "Không vào được màn hình nào khi chưa xong 5 bước" (MANAGER: 2 bước).
 *
 * Đặt SAU resolvePartnerContext nhưng TRƯỚC mọi route khác của /owner (trừ chính các route
 * /owner/onboarding/* — router phải mount onboardingRoutes TRƯỚC middleware này để nó
 * không tự chặn chính mình).
 *
 * Chủ gym có từ trước Phase 1 (`isLegacy`, không có hồ sơ đối tác) đi qua vô điều kiện —
 * không có trình thiết lập nào để họ phải hoàn tất, hành vi y nguyên trước Phase 3.
 */
export async function requireOnboardingComplete(req: Request, res: Response, next: NextFunction): Promise<void> {
  const ctx = req.partner;
  if (!ctx || ctx.isLegacy || !ctx.accountId) {
    next();
    return;
  }

  try {
    // ⚠️ Đọc thẳng cột onboardingCompletedAt đã LƯU, không gọi lại getProgress() để tính
    // sống mỗi request. Bug thật bắt được lúc live-test: tài khoản có sẵn từ trước Phase 3
    // (được backfill onboardingCompletedAt=NOW() lúc migrate — xem migration's UPDATE) có
    // contactPhone/payout/terms đều null vì các cột đó chưa từng tồn tại với họ; tính lại
    // từ đầu mỗi lần sẽ luôn ra completed=false và khoá luôn một chủ gym đang hoạt động
    // bình thường ra khỏi chính hệ thống của họ. Một khi đã hoàn tất (dù do tự làm hay do
    // backfill), cờ này là nguồn sự thật duy nhất — không bao giờ tính lại.
    const account = await partnerRepository.findAccountById(ctx.accountId);
    if (account?.onboardingCompletedAt) {
      next();
      return;
    }

    // Chưa hoàn tất — tính tiến độ chi tiết để trả về, giúp frontend biết đang dở bước nào.
    const progress = await onboardingService.getProgress(ctx.accountId);
    res.status(409).json({
      success: false,
      error: {
        code: 'ONBOARDING_INCOMPLETE',
        message: 'Cần hoàn tất trình thiết lập lần đầu trước khi dùng chức năng này',
      },
      data: progress,
    });
  } catch (e: any) {
    res.status(e.status || 500).json({ success: false, error: { message: e.message } });
  }
}
