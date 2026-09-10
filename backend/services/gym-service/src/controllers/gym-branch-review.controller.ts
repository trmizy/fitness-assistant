import { Request, Response } from 'express';
import { gymBranchReviewService } from '../services/gym-branch-review.service';
import { principalId } from '../middleware/partner-context.middleware';

function fail(res: Response, e: any) {
  res.status(e.status || 500).json({ success: false, error: { message: e.message || 'Đã có lỗi xảy ra' } });
}

/** GYM_BRANCH_FORM_SPEC.md, Phase 4 — "Request Changes" by category. */
export const gymBranchReviewController = {
  async requestChanges(req: Request, res: Response) {
    try {
      const adminId = req.user!.userId;
      const gym = await gymBranchReviewService.requestChanges(req.params.id, adminId, req.body?.issues ?? []);
      res.json({ success: true, data: gym });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async listOpenForOwner(req: Request, res: Response) {
    try {
      const issues = await gymBranchReviewService.listOpenForOwner(req.params.id, principalId(req));
      res.json({ success: true, data: issues });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async listAllForAdmin(req: Request, res: Response) {
    const issues = await gymBranchReviewService.listAllForAdmin(req.params.id);
    res.json({ success: true, data: issues });
  },
};
