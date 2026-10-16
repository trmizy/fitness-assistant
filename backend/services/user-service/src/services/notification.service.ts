import axios from "axios";
import { logger } from "@gym-coach/shared";
import {
  NotificationEventType,
  NotificationEntityType,
} from "../generated/prisma";
import { notificationRepository } from "../repositories/notification.repository";
import { pushDeviceRepository } from "../repositories/push-device.repository";
import { pushService } from "./push.service";

const CHAT_SERVICE_URL =
  process.env.CHAT_SERVICE_URL || "http://chat-service:3005";
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || "";

function pushToSocket(payload: {
  userId?: string;
  adminBroadcast?: boolean;
  notification: any;
}) {
  axios
    .post(`${CHAT_SERVICE_URL}/internal/push-notification`, payload, {
      timeout: 3000,
      headers: { "x-internal-secret": INTERNAL_API_SECRET },
    })
    .catch((err) =>
      logger.warn({ err }, "Failed to push realtime notification"),
    );
}

// Roadmap P4.1 "Notifications/reminders" (§27) — "Need preference
// controls" + "Do not spam". Only the 5 new workout-domain event types
// are gated; every pre-existing CONTRACT_*/SESSION_* type is
// deliberately NOT in this map, so create()'s behavior for them is
// 100% unchanged (no regression risk to code paths this pass never
// touched). CONTRACT_PAUSED_PT_SUSPENDED / CONTRACT_RESUMED_PT_REINSTATED (a PT
// suspension opening / lifting) are deliberately absent too: they are direct
// consequences of the recipient's own contract, like CONTRACT_CANCELLED, so they
// are always stored and pushed — a client must not be able to opt out of hearing
// that their paid contract is paused.
const PREFERENCE_FIELD_BY_EVENT_TYPE: Partial<Record<NotificationEventType, keyof NotificationPreferenceRow>> = {
  WORKOUT_UPCOMING: "workoutUpcomingEnabled",
  WORKOUT_RESCHEDULED: "workoutRescheduledEnabled",
  WORKOUT_UNFINISHED: "workoutUnfinishedEnabled",
  TRAINING_PLAN_UPDATED: "planUpdatedEnabled",
  PT_FEEDBACK_RECEIVED: "ptFeedbackEnabled",
};

type NotificationPreferenceRow = {
  workoutUpcomingEnabled: boolean;
  workoutRescheduledEnabled: boolean;
  workoutUnfinishedEnabled: boolean;
  planUpdatedEnabled: boolean;
  ptFeedbackEnabled: boolean;
};

const DEFAULT_PREFERENCES: NotificationPreferenceRow = {
  workoutUpcomingEnabled: true,
  workoutRescheduledEnabled: true,
  workoutUnfinishedEnabled: true,
  planUpdatedEnabled: true,
  ptFeedbackEnabled: true,
};

type NotificationInput = {
  userId: string;
  text: string;
  eventType: string;
  entityType: string;
  entityId: string;
  link?: string;
};

/** Anything that can write a notification row: the shared client or a transaction's. */
type NotificationDb = { notification: { create: (args: { data: any }) => Promise<any> } };

/**
 * Stores the notification row on `db` and returns it (null when the recipient opted out of the type).
 * NO push, NO socket: callers that must keep the row atomic with a state change pass their transaction
 * client here and push with {@link publishNotification} once it has committed.
 */
async function storeNotification(db: NotificationDb | null, data: NotificationInput) {
  const preferenceField = PREFERENCE_FIELD_BY_EVENT_TYPE[data.eventType as NotificationEventType];
  if (preferenceField) {
    const pref = await notificationRepository.findPreference(data.userId);
    const enabled = pref ? (pref as any)[preferenceField] : DEFAULT_PREFERENCES[preferenceField];
    if (!enabled) {
      // Respecting an explicit opt-out is not a failure — the caller
      // (e.g. a reminder job) should treat this the same as "sent".
      return null;
    }
  }

  const row = {
    userId: data.userId,
    text: data.text,
    eventType: data.eventType as NotificationEventType,
    entityType: data.entityType as NotificationEntityType,
    entityId: data.entityId,
    link: data.link,
  };
  // Callers treat a notification as best-effort and swallow its failure — which is how seven
  // event types the enum did not have went unsent for months without a trace. Whatever the
  // caller does with the error, it is logged here first.
  return (db ? db.notification.create({ data: row }) : notificationRepository.create(row)).catch((error: unknown) => {
    logger.error(
      { eventType: data.eventType, entityType: data.entityType, entityId: data.entityId, message: (error as Error)?.message?.slice(0, 300) },
      "Failed to store notification",
    );
    throw error;
  });
}

/** Real-time + phone push of an already stored notification. Non-blocking, never throws. */
function publishNotification(notification: unknown): void {
  if (!notification || typeof notification !== "object") return;
  try {
    pushToSocket({ userId: (notification as any).userId, notification });
    // Mobile Phase 14.2 — and to the user's phones (non-blocking, never throws).
    void pushService.sendToUser(notification as any);
  } catch (error) {
    logger.warn({ message: (error as Error)?.message }, "Failed to publish stored notification");
  }
}

export const notificationService = {
  async create(data: NotificationInput) {
    const notification = await storeNotification(null, data);
    if (!notification) return null;

    // Push real-time (non-blocking)
    publishNotification(notification);

    return notification;
  },

  /**
   * The row inside the caller's transaction: it commits or rolls back together with the state change it
   * announces, so a crash can neither lose the notice of a committed change nor leave a notice for one
   * that never happened. Push it with {@link publish} once the transaction has committed.
   */
  async createInTx(tx: NotificationDb, data: NotificationInput) {
    return storeNotification(tx, data);
  },

  /** Push of a notification stored by {@link createInTx}; call it after the transaction committed. Never throws. */
  publish(notification: unknown): void {
    publishNotification(notification);
  },

  async getPreferences(userId: string): Promise<NotificationPreferenceRow> {
    const pref = await notificationRepository.findPreference(userId);
    if (!pref) return { ...DEFAULT_PREFERENCES };
    return {
      workoutUpcomingEnabled: pref.workoutUpcomingEnabled,
      workoutRescheduledEnabled: pref.workoutRescheduledEnabled,
      workoutUnfinishedEnabled: pref.workoutUnfinishedEnabled,
      planUpdatedEnabled: pref.planUpdatedEnabled,
      ptFeedbackEnabled: pref.ptFeedbackEnabled,
    };
  },

  async updatePreferences(userId: string, patch: Partial<NotificationPreferenceRow>) {
    await notificationRepository.upsertPreference(userId, patch);
    return this.getPreferences(userId);
  },

  async list(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [notifications, unreadCount] = await Promise.all([
      notificationRepository.findByUser(userId, skip, limit),
      notificationRepository.countUnread(userId),
    ]);
    return { notifications, unreadCount };
  },

  async markRead(id: string, userId: string) {
    return notificationRepository.markRead(id, userId);
  },

  async markAllRead(userId: string) {
    return notificationRepository.markAllRead(userId);
  },

  async getUnreadCount(userId: string) {
    return notificationRepository.countUnread(userId);
  },

  // Mobile Phase 14.2 — the caller's phone subscribes / unsubscribes (see PushDevice).
  async registerDevice(userId: string, token: string, platform: string) {
    await pushDeviceRepository.register(token, userId, platform);
  },

  async unregisterDevice(userId: string, token: string) {
    await pushDeviceRepository.unregister(token, userId);
  },
};
