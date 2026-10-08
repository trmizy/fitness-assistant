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
// Historical naming inconsistency: chat-service's own routes validate this
// against INTERNAL_API_SECRET, while every Lambda (including this one) is
// actually configured with INTERNAL_SERVICE_SECRET - same fallback
// precedence chat-service's own chat.policy.ts/push-relay.ts already use
// for the identical reason, so both sides agree on the same value.
// BUG FIX (found Phase 13C-A, fixed Phase 14A): this used to read ONLY
// INTERNAL_API_SECRET, which no Lambda here has ever been configured with -
// every call was silently sending an empty string as the auth header,
// always rejected by chat-service, always swallowed by the .catch() below.
const CHAT_INTERNAL_SECRET =
  process.env.INTERNAL_SERVICE_SECRET || process.env.INTERNAL_API_SECRET || "";

function pushToSocket(payload: {
  userId?: string;
  adminBroadcast?: boolean;
  notification: any;
}) {
  if (!CHAT_INTERNAL_SECRET) {
    // A missing secret is a configuration bug, not "chat-service is down" -
    // must stay observable and must never be sent as an empty/undefined
    // auth header (chat-service would just reject it anyway).
    logger.error(
      "[notification] INTERNAL_SERVICE_SECRET/INTERNAL_API_SECRET not configured - skipping real-time push to chat-service",
    );
    return;
  }
  axios
    .post(`${CHAT_SERVICE_URL}/internal/push-notification`, payload, {
      timeout: 3000,
      headers: { "x-internal-secret": CHAT_INTERNAL_SECRET },
    })
    .catch((err) => {
      if (err?.response?.status === 401) {
        // Secret configured but rejected - the shared value is out of sync
        // between this service and chat-service. A real defect; must stay
        // observable, never collapsed into the generic "unreachable" case.
        logger.error(
          { status: err.response.status },
          "[notification] chat-service rejected internal auth - INTERNAL_SERVICE_SECRET/INTERNAL_API_SECRET may be out of sync",
        );
        return;
      }
      logger.warn(
        { err: err?.message },
        "Failed to push realtime notification",
      );
    });
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
    // Mobile Phase 14.2 — and to the user's phones (non-blocking, never throws).
    void pushService.sendToUser(notification);

    return notification;
  },

  /**
   * A nudge that is NOT a row in the notifications table: the same two live channels as create()
   * (socket + phone push), for an event the NotificationEventType enum has no value for. Adding
   * one is a schema migration; this keeps a result the user is waiting on from going unannounced
   * in the meantime. Best-effort, never throws.
   */
  pushTransient(data: {
    userId: string;
    text: string;
    eventType: string;
    entityType: string;
    entityId: string;
    link?: string;
  }) {
    const notification = {
      id: `${data.eventType.toLowerCase()}-${data.entityId}-${Date.now()}`,
      userId: data.userId,
      text: data.text,
      eventType: data.eventType,
      entityType: data.entityType,
      entityId: data.entityId,
      link: data.link ?? null,
      unread: true,
      createdAt: new Date().toISOString(),
    };
    pushToSocket({ userId: data.userId, notification });
    void pushService.sendToUser(notification).catch(() => undefined);
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
