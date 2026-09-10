import { Request, Response } from 'express';
import { logger } from '@gym-coach/shared';
import { gymService } from '../services/gym.service';
import { principalId } from '../middleware/partner-context.middleware';

export const gymController = {
  async listPublic(_req: Request, res: Response) {
    const gyms = await gymService.listApproved();
    res.json({ success: true, data: gyms });
  },

  async getPublicById(req: Request, res: Response) {
    try {
      const gym = await gymService.getApprovedById(req.params.id);
      res.json({ success: true, data: gym });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { code: 'NOT_FOUND', message: e.message } });
    }
  },

  async createOwned(req: Request, res: Response) {
    try {
      const ownerId = principalId(req);
      const gym = await gymService.createGym(ownerId, req.body);
      res.status(201).json({ success: true, data: gym });
    } catch (e: any) {
      logger.error(e, 'createOwned gym error');
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  async listOwned(req: Request, res: Response) {
    const ownerId = principalId(req);
    const gyms = await gymService.listOwned(ownerId);
    // Người quản lý chỉ thấy chi nhánh được phân công. Lọc ở đây chứ không ở truy vấn vì
    // gymService.listOwned là đường dùng chung với chủ sở hữu (và với cả tầng nội bộ) —
    // phạm vi là chuyện của người gọi, không phải của kho dữ liệu.
    const ctx = req.partner;
    const visible =
      ctx && ctx.role === 'MANAGER' ? gyms.filter((g: { id: string }) => ctx.scopedGymIds.includes(g.id)) : gyms;
    res.json({ success: true, data: visible });
  },

  async getOwnedById(req: Request, res: Response) {
    try {
      const ownerId = principalId(req);
      const gym = await gymService.getOwnedGym(req.params.id, ownerId);
      res.json({ success: true, data: gym });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  // GYM_BRANCH_FORM_SPEC.md, Phase 5 — shown before the owner confirms permanent closure.
  async closureImpact(req: Request, res: Response) {
    try {
      const ownerId = principalId(req);
      const impact = await gymService.closureImpact(req.params.id, ownerId);
      res.json({ success: true, data: impact });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  async updateOwned(req: Request, res: Response) {
    try {
      const ownerId = principalId(req);
      const gym = await gymService.updateOwnedGym(req.params.id, ownerId, req.body);
      res.json({ success: true, data: gym });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  async setStatus(req: Request, res: Response) {
    try {
      const { status } = req.body;
      const gym = await gymService.setStatus(req.params.id, status);
      res.json({ success: true, data: gym });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  // ── Owner (Vòng 4 / Phase C3) ────────────────────────────────────────
  async setOperationalStatus(req: Request, res: Response) {
    try {
      const ownerId = principalId(req);
      const { operationalStatus, reason, expectedReopenAt } = req.body;
      const gym = await gymService.setOperationalStatus(req.params.id, ownerId, operationalStatus, reason, expectedReopenAt);
      res.json({ success: true, data: gym });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  // ── Admin (Vòng 4 / Phase C2/C3) ─────────────────────────────────────
  async listAllForAdmin(req: Request, res: Response) {
    const VALID = ['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED'];
    const raw = req.query.status;
    const status = typeof raw === 'string' && VALID.includes(raw) ? (raw as any) : undefined;
    const gyms = await gymService.listAllForAdmin(status);
    res.json({ success: true, data: gyms });
  },

  async listPermanentlyClosed(_req: Request, res: Response) {
    const gyms = await gymService.listPermanentlyClosedNeedingReview();
    res.json({ success: true, data: gyms });
  },

  async approveRename(req: Request, res: Response) {
    try {
      const gym = await gymService.approveRename(req.params.id);
      res.json({ success: true, data: gym });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  /** GYM_MANAGEMENT master spec §60/§62 — "Yêu cầu chỉnh sửa" theo từng trường. */
  async requestChanges(req: Request, res: Response) {
    try {
      const adminId = req.user!.userId;
      const { nameNote, addressNote } = req.body ?? {};
      const gym = await gymService.requestChanges(req.params.id, adminId, { nameNote, addressNote });
      res.json({ success: true, data: gym });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },

  async updateAsAdmin(req: Request, res: Response) {
    try {
      const gym = await gymService.updateGymAsAdmin(req.params.id, req.body);
      res.json({ success: true, data: gym });
    } catch (e: any) {
      res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },
};
