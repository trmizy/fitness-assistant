import { Request, Response } from 'express';
import { gymDraftService } from '../services/gym-draft.service';
import { principalId } from '../middleware/partner-context.middleware';

function fail(res: Response, e: any) {
  res.status(e.status || 500).json({ success: false, error: { message: e.message || 'Đã có lỗi xảy ra', issues: e.issues } });
}

/** GYM_BRANCH_FORM_SPEC.md, Phase 1 — "Add Branch" wizard shell endpoints. */
export const gymDraftController = {
  async create(req: Request, res: Response) {
    try {
      const ownerId = principalId(req);
      const draft = await gymDraftService.createDraft(ownerId);
      res.status(201).json({ success: true, data: draft });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async update(req: Request, res: Response) {
    try {
      const ownerId = principalId(req);
      const draft = await gymDraftService.updateDraft(req.params.id, ownerId, req.body ?? {});
      res.json({ success: true, data: draft });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async submit(req: Request, res: Response) {
    try {
      const ownerId = principalId(req);
      const gym = await gymDraftService.submitForReview(req.params.id, ownerId);
      res.json({ success: true, data: gym });
    } catch (e: any) {
      fail(res, e);
    }
  },
};
