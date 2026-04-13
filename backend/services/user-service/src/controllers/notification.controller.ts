import { Response } from 'express';
import { logger } from '@gym-coach/shared';
import { notificationService } from '../services/notification.service';

export const notificationController = {
  async list(req: any, res: Response) {
    try {
      const userId = req.headers['x-user-id'] as string;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const result = await notificationService.list(userId, page, limit);
      res.json(result);
    } catch (error: any) {
      logger.error(error, 'List notifications error');
      res.status(500).json({ error: 'Failed to fetch notifications' });
    }
  },

  async markRead(req: any, res: Response) {
    try {
      const userId = req.headers['x-user-id'] as string;
      await notificationService.markRead(req.params.id, userId);
      res.json({ success: true });
    } catch (error: any) {
      logger.error(error, 'Mark notification read error');
      res.status(500).json({ error: 'Failed to mark notification as read' });
    }
  },

  async markAllRead(req: any, res: Response) {
    try {
      const userId = req.headers['x-user-id'] as string;
      await notificationService.markAllRead(userId);
      res.json({ success: true });
    } catch (error: any) {
      logger.error(error, 'Mark all read error');
      res.status(500).json({ error: 'Failed to mark all as read' });
    }
  },

  async getUnreadCount(req: any, res: Response) {
    try {
      const userId = req.headers['x-user-id'] as string;
      const count = await notificationService.getUnreadCount(userId);
      res.json({ count });
    } catch (error: any) {
      logger.error(error, 'Get unread count error');
      res.status(500).json({ error: 'Failed to get unread count' });
    }
  },
};
