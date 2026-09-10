import { Request, Response } from 'express';
import { gymBranchDocumentService } from '../services/gym-branch-document.service';
import { principalId } from '../middleware/partner-context.middleware';

function fail(res: Response, e: any) {
  res.status(e.status || 500).json({ success: false, error: { message: e.message || 'Đã có lỗi xảy ra' } });
}

/** GYM_BRANCH_FORM_SPEC.md, Phase 3 — Step 6 "Verification". */
export const gymBranchDocumentController = {
  async list(req: Request, res: Response) {
    try {
      const data = await gymBranchDocumentService.listForOwner(req.params.id, principalId(req));
      res.json({ success: true, data });
    } catch (e: any) {
      fail(res, e);
    }
  },

  /** GYM_BRANCH_FORM_SPEC.md, Phase 6 — admin review workspace. */
  async listForAdmin(req: Request, res: Response) {
    try {
      const data = await gymBranchDocumentService.listForAdmin(req.params.id);
      res.json({ success: true, data });
    } catch (e: any) {
      fail(res, e);
    }
  },

  /** Runs AFTER branchDocumentPhotoController.uploadMiddleware — one round trip (upload +
   * attach), unlike GymComplaint's two-step upload-then-submit dance, which exists only
   * because a complaint row doesn't exist yet at photo-picking time. A branch's Gym row
   * already exists by Step 6, so there's nothing to defer attaching to. */
  async attach(req: Request, res: Response) {
    if (!req.file) {
      res.status(400).json({ success: false, error: { message: 'Chưa chọn tệp' } });
      return;
    }
    try {
      const doc = await gymBranchDocumentService.attachFile(
        req.params.id,
        principalId(req),
        req.params.docType as any,
        req.file.filename,
      );
      res.json({ success: true, data: doc });
    } catch (e: any) {
      fail(res, e);
    }
  },
};
