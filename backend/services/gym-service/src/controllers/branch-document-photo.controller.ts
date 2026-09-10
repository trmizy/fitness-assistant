import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { Request, Response } from 'express';
import { isLambdaRuntime } from '../utils/runtime.util';
import { gymBranchDocumentRepository } from '../repositories/gym-branch-document.repository';

/**
 * GYM_BRANCH_FORM_SPEC.md, Phase 3 — Step 6 "Verification". Mirrors
 * complaint-photo.controller.ts exactly (private, no express.static mount, own the
 * upload→attach→serve token lifecycle) — lease/property docs and fire-safety certificates
 * are exactly as sensitive as complaint evidence, arguably more so (they can contain a
 * landlord's name, an address's exact legal ownership status).
 */
const UPLOAD_DIR = 'uploads/branch-documents/';

const upload = isLambdaRuntime()
  ? null
  : multer({
      storage: multer.diskStorage({
        destination: (_req, _file, cb) => {
          fs.mkdirSync(UPLOAD_DIR, { recursive: true });
          cb(null, UPLOAD_DIR);
        },
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, `${(req as Request).user!.userId}-${uniqueSuffix}${path.extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB — legal documents/PDFs can run larger than a complaint photo
      fileFilter: (_req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|webp|pdf/;
        const extOk = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimeOk = allowedTypes.test(file.mimetype);
        if (extOk && mimeOk) cb(null, true);
        else cb(new Error('Chỉ chấp nhận ảnh JPG, PNG, WEBP hoặc tệp PDF'));
      },
    });

export const branchDocumentPhotoController = {
  uploadMiddleware(req: Request, res: Response, next: (err?: any) => void) {
    if (!upload) {
      res.status(503).json({ success: false, error: { message: 'Tải tệp không khả dụng trên môi trường này' } });
      return;
    }
    upload.single('file')(req, res, (err: any) => {
      if (err) {
        res.status(400).json({ success: false, error: { message: err.message || 'Tải tệp thất bại' } });
        return;
      }
      next();
    });
  },

  /** Same two-way rule as complaint-photo.controller.ts's serve: your own upload (token's
   * userId prefix matches), or ADMIN + the token is actually attached to a branch document
   * row (blocks browsing not-yet-attached uploads by guessing tokens). */
  async serve(req: Request, res: Response) {
    const token = req.params.token;
    if (!/^[a-zA-Z0-9_.-]+$/.test(token)) {
      res.status(400).json({ success: false, error: { message: 'Token không hợp lệ' } });
      return;
    }
    const requester = req.user!;
    const isOwnUpload = token.startsWith(`${requester.userId}-`);
    if (!isOwnUpload) {
      if (requester.role !== 'ADMIN') {
        res.status(403).json({ success: false, error: { message: 'Không có quyền xem tệp này' } });
        return;
      }
      const attached = await gymBranchDocumentRepository.existsWithFileToken(token);
      if (!attached) {
        res.status(403).json({ success: false, error: { message: 'Không có quyền xem tệp này' } });
        return;
      }
    }

    const filePath = path.join(process.cwd(), UPLOAD_DIR, token);
    if (!filePath.startsWith(path.join(process.cwd(), UPLOAD_DIR)) || !fs.existsSync(filePath)) {
      res.status(404).json({ success: false, error: { message: 'Không tìm thấy tệp' } });
      return;
    }
    res.sendFile(filePath);
  },
};
