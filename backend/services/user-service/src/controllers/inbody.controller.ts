import { Response } from 'express';
import fs from 'fs';
import { logger } from '@gym-coach/shared';
import { inbodyService } from '../services/inbody.service';
import type { AuthRequest } from '../middleware/auth.middleware';

export const inbodyController = {
  // BR-32: PT accesses a client's InBody history
  async getClientHistory(req: AuthRequest, res: Response) {
    try {
      const ptUserId = req.user?.id;
      if (!ptUserId) return res.status(401).json({ error: 'Unauthorized' });
      const { clientUserId } = req.params;
      const history = await inbodyService.getClientHistory(ptUserId, clientUserId);
      return res.json(history);
    } catch (error: any) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      logger.error(error, 'Get client InBody history error');
      return res.status(500).json({ error: 'Internal server error' });
    }
  },

  async getHistory(req: AuthRequest, res: Response) {
    try {
      const history = await inbodyService.getHistory(req.user!.id);
      return res.json(history);
    } catch (error) {
      logger.error(error, 'Get InBody history error');
      return res.status(500).json({ error: 'Internal server error' });
    }
  },

  async getLatest(req: AuthRequest, res: Response) {
    try {
      const latest = await inbodyService.getLatest(req.user!.id);
      if (!latest) {
        return res.status(404).json({ error: 'No InBody entry found' });
      }
      return res.json(latest);
    } catch (error) {
      logger.error(error, 'Get latest InBody error');
      return res.status(500).json({ error: 'Internal server error' });
    }
  },

  async create(req: AuthRequest, res: Response) {
    try {
      const entry = await inbodyService.createEntry(req.user!.id, req.body);
      return res.json(entry);
    } catch (error: any) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      logger.error(error, 'Create InBody entry error');
      return res.status(500).json({ error: 'Internal server error' });
    }
  },

  // BR-06: edit InBody entry (status, weight, etc.) before confirming.
  async update(req: AuthRequest, res: Response) {
    try {
      const entry = await inbodyService.updateEntry(req.user!.id, req.params.id, req.body);
      return res.json(entry);
    } catch (error: any) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      logger.error(error, 'Update InBody entry error');
      return res.status(500).json({ error: 'Internal server error' });
    }
  },

  async upload(req: AuthRequest, res: Response) {
    const tempPath = req.file?.path;
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image uploaded' });
      }

      const { result, entryData } = await inbodyService.extractFromImage(req.user!.id, req.file.path);
      return res.json({ result, entryData });
    } catch (error: any) {
      // OCR errors are almost always "ảnh người dùng cung cấp không parse được" — that's a
      // 400, not a 500. We only fall back to 500 when error.status explicitly says so.
      const status = error?.status && error.status >= 500 ? error.status : 400;
      logger.error({ err: error?.message }, 'InBody upload/OCR error');
      return res.status(status).json({ error: error.message || 'Failed to extract InBody from image' });
    } finally {
      if (tempPath) {
        fs.unlink(tempPath, (err) => {
          if (err) logger.warn({ err }, 'Failed to delete InBody temp file');
        });
      }
    }
  }
};
