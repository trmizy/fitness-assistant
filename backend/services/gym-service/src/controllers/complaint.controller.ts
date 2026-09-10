import { Request, Response } from 'express';
import { complaintService } from '../services/complaint.service';

function fail(res: Response, e: any) {
  res.status(e.status || 500).json({ success: false, error: { message: e.message || 'Đã có lỗi xảy ra' } });
}

export const complaintController = {
  // ── Client ("Báo cáo vấn đề") ────────────────────────────────────────────
  async submitAsMember(req: Request, res: Response) {
    try {
      const clientId = req.user!.userId;
      const { issueType, description, photoTokens } = req.body ?? {};
      const complaint = await complaintService.submitAsMember(req.params.gymId, clientId, { issueType, description, photoTokens });
      res.status(201).json({ success: true, data: complaint });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async listMine(req: Request, res: Response) {
    const complaints = await complaintService.listMine(req.user!.userId);
    res.json({ success: true, data: complaints });
  },

  // ── Admin ────────────────────────────────────────────────────────────────
  async createByAdmin(req: Request, res: Response) {
    try {
      const adminId = req.user!.userId;
      const { gymId, source, issueType, description, photoTokens, reporterUserId, assignedAdminId } = req.body ?? {};
      const complaint = await complaintService.createByAdmin(adminId, {
        gymId,
        source,
        issueType,
        description,
        photoTokens,
        reporterUserId,
        assignedAdminId,
      });
      res.status(201).json({ success: true, data: complaint });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async queue(req: Request, res: Response) {
    const status = typeof req.query.status === 'string' ? (req.query.status as any) : undefined;
    const complaints = await complaintService.queue(status);
    res.json({ success: true, data: complaints });
  },

  async listForPartner(req: Request, res: Response) {
    const complaints = await complaintService.listForPartner(req.params.id);
    res.json({ success: true, data: complaints });
  },

  async detail(req: Request, res: Response) {
    try {
      const complaint = await complaintService.getById(req.params.id);
      res.json({ success: true, data: complaint });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async updateStatus(req: Request, res: Response) {
    try {
      const adminId = req.user!.userId;
      const { status, adminResponse } = req.body ?? {};
      const complaint = await complaintService.updateStatus(req.params.id, adminId, { status, adminResponse });
      res.json({ success: true, data: complaint });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async assignAdmin(req: Request, res: Response) {
    try {
      const complaint = await complaintService.assignAdmin(req.params.id, req.body?.assignedAdminId ?? null);
      res.json({ success: true, data: complaint });
    } catch (e: any) {
      fail(res, e);
    }
  },
};
