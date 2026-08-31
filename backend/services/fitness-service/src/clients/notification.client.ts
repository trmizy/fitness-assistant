/**
 * Real-time notification push, reusing the exact cross-service chain
 * user-service's notification.service.ts already uses (fitness-service has
 * no user-facing socket connection of its own): a plain HTTP POST to
 * chat-service's internal endpoint, which emits a socket.io event to the
 * user's room. No new infrastructure (no queue/bus) — matches the spec's
 * "không thêm Kafka hoặc dịch vụ hạ tầng lớn cho chức năng này".
 *
 * `pushCycleAssessmentNotification` below is real-time-only (the disclosed
 * gap this doc comment used to describe): delivered if the user is
 * connected, not retrievable later. Roadmap P4.1 "Notifications/reminders"
 * (§27) closes that gap for its own 5 new event types via
 * `createPersistentNotification` — a real cross-service WRITE into
 * user-service's own `Notification` table (via its new internal
 * `/internal/notifications` endpoint), which itself still does the same
 * real-time push AND persists a real, listable row.
 * `pushCycleAssessmentNotification` is intentionally left unchanged
 * (out of scope for this pass — not one of §27's 6 notification types).
 */
import axios from "axios";
import { logger } from "@gym-coach/shared";

const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL ||
  (process.env.NODE_ENV === "production" ? "http://user-service:3004" : "http://localhost:3004");
const CHAT_SERVICE_URL = process.env.CHAT_SERVICE_URL || "http://chat-service:3005";

export async function pushCycleAssessmentNotification(
  userId: string,
  cycleId: string,
  decision: string,
): Promise<void> {
  try {
    await axios.post(
      `${CHAT_SERVICE_URL}/internal/push-notification`,
      {
        userId,
        notification: {
          eventType: "CYCLE_ASSESSMENT_READY",
          entityType: "TRAINING_CYCLE",
          entityId: cycleId,
          text: `Chu kỳ tập luyện của bạn đã được đánh giá: ${decision}`,
          link: `/training-cycles/${cycleId}`,
          createdAt: new Date().toISOString(),
        },
      },
      {
        headers: { "x-internal-secret": process.env.INTERNAL_API_SECRET || "" },
        timeout: 3000,
      },
    );
  } catch (error) {
    // Best-effort — a missed real-time notification must never fail the
    // evaluate request itself (the assessment is already persisted).
    logger.warn(
      { err: (error as Error).message, userId, cycleId },
      "[training-cycle] assessment-ready notification push failed",
    );
  }
}

export type WorkoutNotificationEventType =
  | "WORKOUT_UPCOMING"
  | "WORKOUT_RESCHEDULED"
  | "WORKOUT_UNFINISHED"
  | "TRAINING_PLAN_UPDATED";

/**
 * Roadmap P4.1 "Notifications/reminders" (§27) — persists a real,
 * listable notification (via user-service's own `notificationService.
 * create`, which itself still does the real-time push AND respects the
 * recipient's own preference toggles — never duplicated here). Best-
 * effort: a missed reminder must never fail the request/job that
 * triggered it (the underlying state change — a reschedule, a plan
 * assignment — is already real and persisted regardless of whether the
 * notification succeeds).
 */
export async function createPersistentNotification(params: {
  userId: string;
  text: string;
  eventType: WorkoutNotificationEventType;
  entityId: string;
  link?: string;
}): Promise<void> {
  try {
    await axios.post(
      `${USER_SERVICE_URL}/internal/notifications`,
      {
        userId: params.userId,
        text: params.text,
        eventType: params.eventType,
        entityType: params.eventType === "TRAINING_PLAN_UPDATED" ? "TRAINING_PROGRAM" : "WORKOUT_SCHEDULE",
        entityId: params.entityId,
        link: params.link,
      },
      {
        headers: { "x-service-secret": process.env.INTERNAL_SERVICE_SECRET || "" },
        timeout: 3000,
      },
    );
  } catch (error) {
    logger.warn(
      { err: (error as Error).message, userId: params.userId, eventType: params.eventType },
      "[notification] persistent notification create failed",
    );
  }
}
