import type { Request, Response } from 'express';
import { z } from 'zod';
import { GYM_LIFECYCLE_ACTIONS, gymAdminLifecycleService } from '../services/gym-admin-lifecycle.service';

const body = z
  .object({
    action: z.enum(GYM_LIFECYCLE_ACTIONS, { message: 'Thao tác không hợp lệ' }),
    reason: z.string().max(500, 'Lý do không được vượt quá 500 ký tự').optional(),
    expectedReopenAt: z.string().datetime({ offset: true, message: 'Ngày mở cửa lại không hợp lệ' }).nullable().optional(),
  })
  .strict();

/** FIX2-ADMIN Q5 — PATCH /admin/gyms/:id/lifecycle. See gymAdminLifecycleService for the rules. */
export const gymAdminLifecycleController = {
  async apply(req: Request, res: Response) {
    const parsed = body.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ' } });
      return;
    }
    try {
      const gym = await gymAdminLifecycleService.apply(req.params.id, req.user!.userId, {
        action: parsed.data.action,
        reason: parsed.data.reason,
        expectedReopenAt: parsed.data.expectedReopenAt ? new Date(parsed.data.expectedReopenAt) : null,
      });
      res.json({ success: true, data: gym });
    } catch (e: any) {
      const code = e.status && typeof e.code === 'string' ? { code: e.code } : {};
      res.status(e.status || 500).json({ success: false, error: { ...code, message: e.status ? e.message : 'Không thể cập nhật trạng thái chi nhánh' } });
    }
  },
};
