import type { Request, Response } from 'express';
import { logger } from '@gym-coach/shared';
import { assistedCheckinService, businessCodeOf, type StaffActor } from '../services/assisted-checkin.service';

/**
 * D15c — quầy lễ tân: tra hội viên, gửi OTP, check-in hộ, ngoại lệ. Danh tính người thao tác LUÔN lấy từ phiên đăng nhập +
 * ngữ cảnh đối tác (req.user / req.partner) - body không thể chỉ định ai là nhân viên hay hội viên là ai (chỉ
 * membershipId của dòng kết quả tra cứu, và máy chủ kiểm lại nó thuộc thương hiệu của chi nhánh).
 */
function actorOf(req: Request): StaffActor {
  return { userId: req.user!.userId, role: req.partner!.role, principalUserId: req.partner!.principalUserId };
}

function sendError(res: Response, e: any, what: string) {
  const biz = businessCodeOf(e);
  if (biz) return res.status(biz.status).json({ success: false, error: { code: biz.code } });
  if (e?.status && e.status < 500) return res.status(e.status).json({ success: false, error: { message: e.message } });
  logger.error(e, `assisted checkin: ${what}`);
  return res.status(500).json({ success: false, error: { message: 'Lỗi hệ thống' } });
}

export const assistedCheckinController = {
  async config(_req: Request, res: Response) {
    return res.json({ success: true, data: assistedCheckinService.config() });
  },

  async searchMembers(req: Request, res: Response) {
    try {
      const { code, name, last4 } = req.query as Record<string, unknown>;
      const data = await assistedCheckinService.searchMembers(actorOf(req), req.params.gymId, { code, name, last4 });
      return res.json({ success: true, data });
    } catch (e) {
      return sendError(res, e, 'search');
    }
  },

  async requestOtp(req: Request, res: Response) {
    try {
      const data = await assistedCheckinService.requestOtp(actorOf(req), req.params.gymId, { membershipId: req.body?.membershipId });
      return res.status(201).json({ success: true, data });
    } catch (e) {
      return sendError(res, e, 'otp');
    }
  },

  async checkIn(req: Request, res: Response) {
    try {
      const data = (await assistedCheckinService.assistedCheckIn(actorOf(req), req.params.gymId, req.body)) as { replayed?: boolean };
      return res.status(data.replayed ? 200 : 201).json({ success: true, data });
    } catch (e) {
      return sendError(res, e, 'check-in');
    }
  },

  async requestException(req: Request, res: Response) {
    try {
      const data = await assistedCheckinService.requestException(actorOf(req), req.params.gymId, req.body);
      return res.status(201).json({ success: true, data });
    } catch (e) {
      return sendError(res, e, 'exception request');
    }
  },

  async listExceptions(req: Request, res: Response) {
    try {
      const data = await assistedCheckinService.listExceptions(actorOf(req), req.params.gymId);
      return res.json({ success: true, data });
    } catch (e) {
      return sendError(res, e, 'exception list');
    }
  },

  async decideException(req: Request, res: Response, decision: 'APPROVE' | 'REJECT') {
    try {
      const data = await assistedCheckinService.decideException(actorOf(req), req.params.gymId, req.params.exceptionId, decision, req.body?.reason);
      return res.json({ success: true, data });
    } catch (e) {
      return sendError(res, e, 'exception decision');
    }
  },
  approveException(req: Request, res: Response) {
    return assistedCheckinController.decideException(req, res, 'APPROVE');
  },
  rejectException(req: Request, res: Response) {
    return assistedCheckinController.decideException(req, res, 'REJECT');
  },
};
