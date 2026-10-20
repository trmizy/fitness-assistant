import { Request, Response } from 'express';
import { logger } from '@gym-coach/shared';
import { gymService } from '../services/gym.service';
import { principalId } from '../middleware/partner-context.middleware';
import { LISTING_REVIEW_REQUIRED, sendListingReviewRequired } from '../services/client-compat.service';
import { ListingError, MIN_ADMIN_REASON_LENGTH } from '../services/gym-listing.schemas';
import { sendListingError } from './gym-listing.controller';
import { listingCompatOf } from '../services/legacy-compat.service';

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
      const gym = await gymService.createGym(ownerId, req.body, listingCompatOf(req));
      res.status(201).json({ success: true, data: gym });
    } catch (e: any) {
      if (e.status && e.status < 500) {
        // 4xx are the client's to read (Vietnamese message, stable code); only real failures are logged as errors.
        res.status(e.status).json({ success: false, error: { ...(typeof e.code === 'string' ? { code: e.code } : {}), message: e.message }, message: e.message, ...(e.extra ?? {}) });
        return;
      }
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
      // description / facilities of a branch that has left DRAFT: 409 in the shared old-client body shape.
      if (e?.code === LISTING_REVIEW_REQUIRED) return sendListingReviewRequired(req, res);
      const code = e.status && typeof e.code === 'string' ? { code: e.code } : {};
      res.status(e.status || 500).json({ success: false, error: { ...code, message: e.message } });
    }
  },

  async setStatus(req: Request, res: Response) {
    try {
      const { status } = req.body;
      const gym = await gymService.setStatus(req.params.id, status, req.user!.userId);
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
      // principalId says whose gym this is; the ACTOR is whoever is logged in. For a MANAGER the
      // two differ, and the service needs the second one — both to decide whether a permanent
      // closure is allowed (OWNER only) and to stamp who closed the branch.
      const actor = req.partner ? { userId: req.user!.userId, role: req.partner.role } : undefined;
      const gym = await gymService.setOperationalStatus(req.params.id, ownerId, operationalStatus, reason, expectedReopenAt, actor);
      res.json({ success: true, data: gym });
    } catch (e: any) {
      // `code` only for errors the service raised on purpose (they carry a status) — e.g.
      // OWNER_ROLE_REQUIRED, so a client can tell "not your role" from any other 403.
      const code = e.status && typeof e.code === 'string' ? { code: e.code } : {};
      res.status(e.status || 500).json({ success: false, error: { ...code, message: e.message } });
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
      const gym = await gymService.approveRename(req.params.id, req.user!.userId);
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
      const { reason, expectedListingVersion, ...fields } = req.body ?? {};
      // `description` is part of the public listing: an admin edit of it is an ADMIN_DIRECT revision (reason of at least
      // MIN_ADMIN_REASON_LENGTH characters, stored on the revision; expectedListingVersion optional - when given it must
      // match). The other fields (name / address / city / phone / email) are operational and only get an audit row.
      const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
      if (fields.description !== undefined && trimmedReason.length < MIN_ADMIN_REASON_LENGTH) {
        return res.status(400).json({
          success: false,
          error: { code: 'REASON_REQUIRED', message: `Cần nhập lý do (tối thiểu ${MIN_ADMIN_REASON_LENGTH} ký tự) khi sửa phần giới thiệu của chi nhánh` },
        });
      }
      const gym = await gymService.updateGymAsAdmin(req.params.id, fields, {
        adminId: req.user!.userId,
        reason: trimmedReason || undefined,
        expectedListingVersion: typeof expectedListingVersion === 'number' ? expectedListingVersion : undefined,
      });
      return res.json({ success: true, data: gym });
    } catch (e: any) {
      // The listing workflow answers with its machine codes (LISTING_STALE, GYM_IS_DRAFT, NO_CHANGES, ...).
      if (e instanceof ListingError) return sendListingError(res, e);
      return res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },
};
