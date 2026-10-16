import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { notificationController } from "../controllers/notification.controller";

const router = Router();

router.get("/", authMiddleware, notificationController.list as any);
router.get(
  "/unread-count",
  authMiddleware,
  notificationController.getUnreadCount as any,
);
router.patch(
  "/read-all",
  authMiddleware,
  notificationController.markAllRead as any,
);
router.patch(
  "/:id/read",
  authMiddleware,
  notificationController.markRead as any,
);
// Roadmap P4.1 "Notifications/reminders" — named routes, must stay
// before /:id/read-style dynamic routes would ever risk shadowing them
// (Express already matches these by exact literal segment, but kept
// grouped with the other named routes above for readability).
router.get(
  "/preferences",
  authMiddleware,
  notificationController.getPreferences as any,
);
router.put(
  "/preferences",
  authMiddleware,
  notificationController.updatePreferences as any,
);
// Mobile Phase 14.2 — this phone subscribes to / unsubscribes from push notifications.
router.post(
  "/devices",
  authMiddleware,
  notificationController.registerDevice as any,
);
router.delete(
  "/devices/:token",
  authMiddleware,
  notificationController.unregisterDevice as any,
);

export default router;
