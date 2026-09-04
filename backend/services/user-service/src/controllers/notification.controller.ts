import { Response } from "express";
import { logger } from "@gym-coach/shared";
import { notificationService } from "../services/notification.service";

export const notificationController = {
  async list(req: any, res: Response) {
    try {
      const userId = req.headers["x-user-id"] as string;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const result = await notificationService.list(userId, page, limit);
      res.json(result);
    } catch (error: any) {
      logger.error(error, "List notifications error");
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  },

  async markRead(req: any, res: Response) {
    try {
      const userId = req.headers["x-user-id"] as string;
      await notificationService.markRead(req.params.id, userId);
      res.json({ success: true });
    } catch (error: any) {
      logger.error(error, "Mark notification read error");
      res.status(500).json({ error: "Failed to mark notification as read" });
    }
  },

  async markAllRead(req: any, res: Response) {
    try {
      const userId = req.headers["x-user-id"] as string;
      await notificationService.markAllRead(userId);
      res.json({ success: true });
    } catch (error: any) {
      logger.error(error, "Mark all read error");
      res.status(500).json({ error: "Failed to mark all as read" });
    }
  },

  async getUnreadCount(req: any, res: Response) {
    try {
      const userId = req.headers["x-user-id"] as string;
      const count = await notificationService.getUnreadCount(userId);
      res.json({ count });
    } catch (error: any) {
      logger.error(error, "Get unread count error");
      res.status(500).json({ error: "Failed to get unread count" });
    }
  },

  // Roadmap P4.1 "Notifications/reminders" (§27) — preference controls.
  async getPreferences(req: any, res: Response) {
    try {
      const userId = req.headers["x-user-id"] as string;
      const preferences = await notificationService.getPreferences(userId);
      res.json(preferences);
    } catch (error: any) {
      logger.error(error, "Get notification preferences error");
      res.status(500).json({ error: "Failed to get notification preferences" });
    }
  },

  async updatePreferences(req: any, res: Response) {
    try {
      const userId = req.headers["x-user-id"] as string;
      const allowedKeys = [
        "workoutUpcomingEnabled",
        "workoutRescheduledEnabled",
        "workoutUnfinishedEnabled",
        "planUpdatedEnabled",
        "ptFeedbackEnabled",
      ] as const;
      const patch: Record<string, boolean> = {};
      for (const key of allowedKeys) {
        if (typeof req.body?.[key] === "boolean") patch[key] = req.body[key];
      }
      const preferences = await notificationService.updatePreferences(userId, patch);
      res.json(preferences);
    } catch (error: any) {
      logger.error(error, "Update notification preferences error");
      res.status(500).json({ error: "Failed to update notification preferences" });
    }
  },
};
