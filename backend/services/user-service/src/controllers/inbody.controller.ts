import { Response } from 'express';
import { logger } from '@gym-coach/shared';
import { inbodyService } from '../services/inbody.service';
import type { AuthRequest } from '../middleware/auth.middleware';

export const inbodyController = {
  async getHistory(req: AuthRequest, res: Response) {
    try {
      const history = await inbodyService.getHistory(req.user!.id);
      return res.json(history);
    } catch (error) {
      logger.error(error, 'Get InBody history error');
      return res.status(500).json({ error: 'Internal server error' });
    }
  },

  async create(req: AuthRequest, res: Response) {
    try {
      const entry = await inbodyService.createEntry(req.user!.id, req.body);
      return res.json(entry);
    } catch (error) {
      logger.error(error, 'Create InBody entry error');
      return res.status(500).json({ error: 'Internal server error' });
    }
  },

  async upload(req: AuthRequest, res: Response) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image uploaded' });
      }

      const { result, entryData } = await inbodyService.extractFromImage(req.user!.id, req.file.path);
      return res.json({ result, entryData });
    } catch (error: any) {
      logger.error(error, 'InBody upload/OCR error');
      return res.status(500).json({ error: error.message });
    }
  }
};
