import { Request, Response } from 'express';
import { gymDraftService } from '../services/gym-draft.service';
import { principalId } from '../middleware/partner-context.middleware';
import { listingCompatOf } from '../services/legacy-compat.service';

function fail(res: Response, e: any) {
  const code = e.status && typeof e.code === 'string' ? { code: e.code } : {};
  res.status(e.status || 500).json({ success: false, error: { ...code, message: e.message || 'Đã có lỗi xảy ra', issues: e.issues }, message: e.message || 'Đã có lỗi xảy ra' });
}

/** GYM_BRANCH_FORM_SPEC.md, Phase 1 — "Add Branch" wizard shell endpoints. */
export const gymDraftController = {
  async create(req: Request, res: Response) {
    try {
      const ownerId = principalId(req);
      const draft = await gymDraftService.createDraft(ownerId, listingCompatOf(req));
      res.status(201).json({ success: true, data: draft });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async update(req: Request, res: Response) {
    try {
      const ownerId = principalId(req);
      const draft = await gymDraftService.updateDraft(req.params.id, ownerId, req.body ?? {}, listingCompatOf(req));
      res.json({ success: true, data: draft });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async submit(req: Request, res: Response) {
    try {
      const ownerId = principalId(req);
      const gym = await gymDraftService.submitForReview(req.params.id, ownerId, listingCompatOf(req));
      res.json({ success: true, data: gym });
    } catch (e: any) {
      fail(res, e);
    }
  },
};
