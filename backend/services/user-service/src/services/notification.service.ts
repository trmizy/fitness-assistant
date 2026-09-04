import axios from "axios";
import { logger } from "@gym-coach/shared";
import {
  NotificationEventType,
  NotificationEntityType,
} from "../generated/prisma";
import { notificationRepository } from "../repositories/notification.repository";

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
// touched).
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

export const notificationService = {
  async create(data: {
    userId: string;
    text: string;
    eventType: string;
    entityType: string;
    entityId: string;
    link?: string;
  }) {
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

    const notification = await notificationRepository.create({
      userId: data.userId,
      text: data.text,
      eventType: data.eventType as NotificationEventType,
      entityType: data.entityType as NotificationEntityType,
      entityId: data.entityId,
      link: data.link,
    });

    // Push real-time (non-blocking)
    pushToSocket({ userId: data.userId, notification });

    return notification;
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
};
