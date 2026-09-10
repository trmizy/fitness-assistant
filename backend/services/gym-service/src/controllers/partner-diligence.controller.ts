import { Request, Response } from 'express';
import { partnerDiligenceService } from '../services/partner-diligence.service';
import { partnerAuditService } from '../services/partner-audit.service';

function fail(res: Response, e: any) {
  res.status(e.status || 500).json({ success: false, error: { message: e.message || 'Đã có lỗi xảy ra' } });
}

export const partnerDiligenceController = {
  async queue(_req: Request, res: Response) {
    const data = await partnerDiligenceService.queue();
    res.json({ success: true, data });
  },

  async overviewStats(_req: Request, res: Response) {
    const data = await partnerDiligenceService.overviewStats();
    res.json({ success: true, data });
  },

  async listDocuments(req: Request, res: Response) {
    const docs = await partnerDiligenceService.listDocuments(req.params.id);
    res.json({ success: true, data: docs });
  },

  async upsertDocument(req: Request, res: Response) {
    try {
      const doc = await partnerDiligenceService.upsertDocument(req.params.id, req.params.docType as any, req.body?.fileUrl);
      res.json({ success: true, data: doc });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async verifyDocument(req: Request, res: Response) {
    try {
      const adminId = req.user!.userId;
      const { decision, expiresAt } = req.body ?? {};
      if (decision !== 'VERIFIED' && decision !== 'REJECTED') {
        res.status(400).json({ success: false, error: { message: 'decision phải là VERIFIED hoặc REJECTED' } });
        return;
      }
      const doc = await partnerDiligenceService.verifyDocument(
        req.params.id,
        req.params.docType as any,
        adminId,
        decision,
        expiresAt ? new Date(expiresAt) : null,
      );
      res.json({ success: true, data: doc });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async listContactLog(req: Request, res: Response) {
    const logs = await partnerDiligenceService.listContactLog(req.params.id);
    res.json({ success: true, data: logs });
  },

  async addContactLog(req: Request, res: Response) {
    try {
      const adminId = req.user!.userId;
      const { channel, note, occurredAt } = req.body ?? {};
      const log = await partnerDiligenceService.addContactLog(req.params.id, {
        channel,
        note,
        occurredAt: occurredAt ? new Date(occurredAt) : undefined,
        createdBy: adminId,
      });
      res.status(201).json({ success: true, data: log });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async reject(req: Request, res: Response) {
    try {
      const adminId = req.user!.userId;
      const reason = req.body?.reason;
      const partner = await partnerDiligenceService.reject(req.params.id, reason, adminId);
      await partnerAuditService.record({ partnerId: partner.id, actorUserId: adminId, action: 'PARTNER_UPDATED', reason, req, metadata: { rejected: true } });
      res.json({ success: true, data: partner });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async reopen(req: Request, res: Response) {
    try {
      const adminId = req.user!.userId;
      const partner = await partnerDiligenceService.reopen(req.params.id);
      await partnerAuditService.record({ partnerId: partner.id, actorUserId: adminId, action: 'PARTNER_UPDATED', req, metadata: { reopened: true } });
      res.json({ success: true, data: partner });
    } catch (e: any) {
      fail(res, e);
    }
  },

  /** GYM_MANAGEMENT master spec §60 — chuyển trục thẩm định (không dùng cho REJECTED, xem
   * doc comment ở service). */
  async setVerificationStatus(req: Request, res: Response) {
    try {
      const adminId = req.user!.userId;
      const { verificationStatus, notes } = req.body ?? {};
      const partner = await partnerDiligenceService.setVerificationStatus(req.params.id, verificationStatus, adminId, notes);
      await partnerAuditService.record({
        partnerId: partner.id,
        actorUserId: adminId,
        action: 'PARTNER_UPDATED',
        reason: notes,
        req,
        metadata: { verificationStatus },
      });
      res.json({ success: true, data: partner });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async assignAdmin(req: Request, res: Response) {
    try {
      const adminId = req.user!.userId;
      const partner = await partnerDiligenceService.assignAdmin(req.params.id, req.body?.assignedAdminId ?? null);
      await partnerAuditService.record({
        partnerId: partner.id,
        actorUserId: adminId,
        action: 'PARTNER_UPDATED',
        req,
        metadata: { assignedAdminId: partner.assignedAdminId },
      });
      res.json({ success: true, data: partner });
    } catch (e: any) {
      fail(res, e);
    }
  },

  // ── PartnerInternalNote — chỉ mount ở admin.routes.ts, KHÔNG BAO GIỜ ở owner.routes.ts ──
  async listInternalNotes(req: Request, res: Response) {
    const notes = await partnerDiligenceService.listInternalNotes(req.params.id);
    res.json({ success: true, data: notes });
  },

  async addInternalNote(req: Request, res: Response) {
    try {
      const adminId = req.user!.userId;
      const note = await partnerDiligenceService.addInternalNote(req.params.id, adminId, req.body?.text);
      res.status(201).json({ success: true, data: note });
    } catch (e: any) {
      fail(res, e);
    }
  },
};
