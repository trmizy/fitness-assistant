import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { Request, Response } from 'express';
import { isLambdaRuntime } from '../utils/runtime.util';
import { complaintRepository } from '../repositories/complaint.repository';

/**
 * GYM_MANAGEMENT master spec, Phase 5 — "Ảnh minh chứng không bao giờ hiển thị công khai."
 * Mirrors user-service's PT-application upload pattern (local-disk multer, disabled on
 * Lambda — see runtime.util.ts) but with NO public express.static mount: every read goes
 * through `serve` below, which checks the requester actually has a legitimate reason to see
 * this exact file, unlike profile photos (public by nature) or PT-application documents
 * (served via a separate signed-preview mechanism this feature doesn't need — a complaint's
 * photos are only ever looked at by two people: the reporter and admin staff).
 *
 * Token format: `<uploaderUserId>-<timestamp>-<random><ext>` — the uploader prefix is what
 * makes the ownership check in `serve` possible without a database round-trip for the
 * reporter's own case; admin's case does need one (see `serve`'s doc comment).
 */
const UPLOAD_DIR = 'uploads/complaint-photos/';

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
      limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
      fileFilter: (_req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|webp/;
        const extOk = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimeOk = allowedTypes.test(file.mimetype);
        if (extOk && mimeOk) cb(null, true);
        else cb(new Error('Chỉ chấp nhận ảnh JPG, PNG hoặc WEBP'));
      },
    });

export const complaintPhotoController = {
  uploadMiddleware(req: Request, res: Response, next: (err?: any) => void) {
    if (!upload) {
      res.status(503).json({ success: false, error: { message: 'Tải ảnh không khả dụng trên môi trường này' } });
      return;
    }
    upload.single('photo')(req, res, (err: any) => {
      if (err) {
        res.status(400).json({ success: false, error: { message: err.message || 'Tải ảnh thất bại' } });
        return;
      }
      next();
    });
  },

  async upload(req: Request, res: Response) {
    if (!req.file) {
      res.status(400).json({ success: false, error: { message: 'Chưa chọn ảnh' } });
      return;
    }
    res.status(201).json({ success: true, data: { token: req.file.filename } });
  },

  /**
   * Two ways to be allowed to see a given token: (1) it's your OWN upload (the filename's
   * userId prefix matches yours — works even before the complaint is submitted, since the
   * uploader legitimately owns what they just uploaded), or (2) you're ADMIN and the token
   * is actually attached to a submitted complaint (blocks an admin from browsing arbitrary
   * not-yet-submitted uploads by guessing tokens — defense in depth on top of the token
   * itself already being unguessable).
   */
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
        res.status(403).json({ success: false, error: { message: 'Không có quyền xem ảnh này' } });
        return;
      }
      const attached = await complaintRepository.existsWithPhotoToken(token);
      if (!attached) {
        res.status(403).json({ success: false, error: { message: 'Không có quyền xem ảnh này' } });
        return;
      }
    }

    const filePath = path.join(process.cwd(), UPLOAD_DIR, token);
    if (!filePath.startsWith(path.join(process.cwd(), UPLOAD_DIR)) || !fs.existsSync(filePath)) {
      res.status(404).json({ success: false, error: { message: 'Không tìm thấy ảnh' } });
      return;
    }
    res.sendFile(filePath);
  },
};
