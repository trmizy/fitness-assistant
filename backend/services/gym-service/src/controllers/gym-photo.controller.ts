import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { Request, Response } from 'express';
import { isLambdaRuntime } from '../utils/runtime.util';
import { gymPhotoService } from '../services/gym-photo.service';
import { principalId } from '../middleware/partner-context.middleware';

/**
 * GYM_BRANCH_FORM_SPEC.md, Phase 3 — Step 5 "Photos". Unlike complaint-photo.controller.ts
 * and branch-document-photo.controller.ts, these files are PUBLIC on purpose (a branch's
 * marketing gallery, same exposure level as a profile photo) — served via a plain
 * express.static mount in app.ts, so this controller only handles the write side
 * (upload/delete/set-cover/reorder). No `serve`/token-ownership-check function here at all.
 */
const UPLOAD_DIR = 'uploads/gym-photos/';

const upload = isLambdaRuntime()
  ? null
  : multer({
      storage: multer.diskStorage({
        destination: (_req, _file, cb) => {
          fs.mkdirSync(UPLOAD_DIR, { recursive: true });
          cb(null, UPLOAD_DIR);
        },
        filename: (_req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, `${uniqueSuffix}${path.extname(file.originalname)}`);
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

function fail(res: Response, e: any) {
  res.status(e.status || 500).json({ success: false, error: { message: e.message || 'Đã có lỗi xảy ra' } });
}

export const gymPhotoController = {
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

  async list(req: Request, res: Response) {
    try {
      const photos = await gymPhotoService.listForOwner(req.params.id, principalId(req));
      res.json({ success: true, data: photos });
    } catch (e: any) {
      fail(res, e);
    }
  },

  /** GYM_BRANCH_FORM_SPEC.md, Phase 6 — admin review workspace. */
  async listForAdmin(req: Request, res: Response) {
    const photos = await gymPhotoService.listForAdmin(req.params.id);
    res.json({ success: true, data: photos });
  },

  async upload(req: Request, res: Response) {
    if (!req.file) {
      res.status(400).json({ success: false, error: { message: 'Chưa chọn ảnh' } });
      return;
    }
    try {
      const photo = await gymPhotoService.upload(req.params.id, principalId(req), req.file.filename);
      res.status(201).json({ success: true, data: photo });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async remove(req: Request, res: Response) {
    try {
      await gymPhotoService.delete(req.params.id, principalId(req), req.params.photoId);
      res.json({ success: true });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async setCover(req: Request, res: Response) {
    try {
      const photos = await gymPhotoService.setCover(req.params.id, principalId(req), req.params.photoId);
      res.json({ success: true, data: photos });
    } catch (e: any) {
      fail(res, e);
    }
  },

  async reorder(req: Request, res: Response) {
    try {
      const ids = req.body?.photoIds;
      if (!Array.isArray(ids)) {
        res.status(400).json({ success: false, error: { message: 'photoIds phải là một mảng' } });
        return;
      }
      const photos = await gymPhotoService.reorder(req.params.id, principalId(req), ids);
      res.json({ success: true, data: photos });
    } catch (e: any) {
      fail(res, e);
    }
  },
};
