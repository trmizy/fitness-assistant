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

  // Mobile Phase 14.2 — POST /notifications/devices { token, platform? }. The owner is always
  // the authenticated caller (x-user-id from the gateway), never a body field.
  async registerDevice(req: any, res: Response) {
    try {
      const userId = req.headers["x-user-id"] as string;
      const token = req.body?.token;
      const platform = req.body?.platform ?? "android";
      if (!isPlausibleToken(token)) {
        res.status(400).json({ error: "INVALID_PUSH_TOKEN" });
        return;
      }
      if (platform !== "android") {
        res.status(400).json({ error: "UNSUPPORTED_PLATFORM" });
        return;
      }
      await notificationService.registerDevice(userId, token, platform);
      res.status(204).end();
    } catch (error: any) {
      logger.error(error, "Register push device error");
      res.status(500).json({ error: "Failed to register device" });
    }
  },

  // DELETE /notifications/devices/:token — sign-out. Only removes the caller's own row.
  async unregisterDevice(req: any, res: Response) {
    try {
      const userId = req.headers["x-user-id"] as string;
      const token = req.params.token;
      if (!isPlausibleToken(token)) {
        res.status(400).json({ error: "INVALID_PUSH_TOKEN" });
        return;
      }
      await notificationService.unregisterDevice(userId, token);
      res.status(204).end();
    } catch (error: any) {
      logger.error(error, "Unregister push device error");
      res.status(500).json({ error: "Failed to unregister device" });
    }
  },
};

/** FCM registration tokens are long opaque strings; this only rejects obvious garbage. */
export function isPlausibleToken(token: unknown): token is string {
  return typeof token === "string" && token.length >= 20 && token.length <= 4096 && !/\s/.test(token);
}
