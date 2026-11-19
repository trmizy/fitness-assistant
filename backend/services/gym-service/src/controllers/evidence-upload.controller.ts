import type { Request, Response } from 'express';
import { principalId } from '../middleware/partner-context.middleware';
import { complaintRepository } from '../repositories/complaint.repository';
import { gymBranchDocumentRepository } from '../repositories/gym-branch-document.repository';
import { ALL_DOC_TYPES, gymBranchDocumentService } from '../services/gym-branch-document.service';
import {
  EvidenceUploadError,
  mayViewEvidence,
  privateEvidenceUpload,
  type EvidenceKind,
} from '../services/private-evidence-upload.service';
import type { BranchDocumentType } from '../generated/prisma';

/**
 * Tải lên trực tiếp S3 cho ảnh khiếu nại và giấy tờ chi nhánh (thay multer ghi đĩa, vốn bị tắt trên Lambda).
 * Xem private-evidence-upload.service.ts. Các route `/url` thay cho `serve` cũ: cùng luật xem, nhưng trả link ngắn hạn
 * (client tải thẳng từ S3, KHÔNG gửi kèm JWT sang S3 — S3 từ chối request có cả Authorization lẫn chữ ký trên URL).
 */

function fail(res: Response, e: any) {
  if (e instanceof EvidenceUploadError || typeof e?.status === 'number') {
    res.status(e.status).json({
      success: false,
      error: { ...(typeof e.code === 'string' ? { code: e.code } : {}), message: e.message || 'Đã có lỗi xảy ra' },
    });
    return;
  }
  res.status(500).json({ success: false, error: { message: e?.message || 'Đã có lỗi xảy ra' } });
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v));
const str = (v: unknown) => (typeof v === 'string' ? v : '');

async function viewUrl(req: Request, res: Response, kind: EvidenceKind, isAttached: (t: string) => Promise<boolean>) {
  try {
    const token = req.params.token;
    const verdict = await mayViewEvidence({ token, requester: req.user!, isAttached });
    if (verdict === 'BAD_TOKEN') {
      res.status(400).json({ success: false, error: { message: 'Token không hợp lệ' } });
      return;
    }
    if (verdict === 'FORBIDDEN') {
      res.status(403).json({ success: false, error: { message: 'Không có quyền xem tệp này' } });
      return;
    }
    if (!(await privateEvidenceUpload.exists(kind, token))) {
      res.status(404).json({ success: false, error: { message: 'Không tìm thấy tệp' } });
      return;
    }
    res.json({ success: true, data: await privateEvidenceUpload.viewUrl(kind, token) });
  } catch (e) {
    fail(res, e);
  }
}

export const evidenceUploadController = {
  // ── Ảnh khiếu nại (hội viên) ────────────────────────────────────────────────
  async complaintPresign(req: Request, res: Response) {
    try {
      const data = await privateEvidenceUpload.presign({
        kind: 'COMPLAINT_PHOTO',
        userId: req.user!.userId,
        contentType: str(req.body?.contentType),
        sizeBytes: num(req.body?.sizeBytes),
      });
      res.status(201).json({ success: true, data });
    } catch (e) {
      fail(res, e);
    }
  },

  async complaintConfirm(req: Request, res: Response) {
    try {
      const data = await privateEvidenceUpload.confirm({ kind: 'COMPLAINT_PHOTO', userId: req.user!.userId, uploadId: req.body?.uploadId });
      res.status(201).json({ success: true, data });
    } catch (e) {
      fail(res, e);
    }
  },

  complaintPhotoUrl: (req: Request, res: Response) =>
    viewUrl(req, res, 'COMPLAINT_PHOTO', (t) => complaintRepository.existsWithPhotoToken(t)),

  // ── Giấy tờ chi nhánh (chủ gym) ─────────────────────────────────────────────
  async branchDocumentPresign(req: Request, res: Response) {
    try {
      const docType = req.params.docType as BranchDocumentType;
      if (!ALL_DOC_TYPES.includes(docType)) {
        res.status(400).json({ success: false, error: { message: 'Loại giấy tờ không hợp lệ' } });
        return;
      }
      await gymBranchDocumentService.assertCanUpload(req.params.id, principalId(req), docType);
      const data = await privateEvidenceUpload.presign({
        kind: 'BRANCH_DOCUMENT',
        userId: req.user!.userId,
        contentType: str(req.body?.contentType),
        sizeBytes: num(req.body?.sizeBytes),
        scope: `${req.params.id}:${docType}`,
      });
      res.status(201).json({ success: true, data });
    } catch (e) {
      fail(res, e);
    }
  },

  /** Xác nhận + đính kèm trong MỘT lượt (như bản multipart cũ): trả dòng giấy tờ sau khi đính kèm. */
  async branchDocumentConfirm(req: Request, res: Response) {
    try {
      const docType = req.params.docType as BranchDocumentType;
      await gymBranchDocumentService.assertCanUpload(req.params.id, principalId(req), docType);
      const { token } = await privateEvidenceUpload.confirm({
        kind: 'BRANCH_DOCUMENT',
        userId: req.user!.userId,
        uploadId: req.body?.uploadId,
        scope: `${req.params.id}:${docType}`,
      });
      const doc = await gymBranchDocumentService.attachFile(req.params.id, principalId(req), docType, token);
      res.json({ success: true, data: doc });
    } catch (e) {
      fail(res, e);
    }
  },

  branchDocumentUrl: (req: Request, res: Response) =>
    viewUrl(req, res, 'BRANCH_DOCUMENT', (t) => gymBranchDocumentRepository.existsWithFileToken(t)),
};
