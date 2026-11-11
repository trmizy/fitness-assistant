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
import { invokeHttpLambda } from "./lambda-http.client";

const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL ||
  (process.env.NODE_ENV === "production" ? "http://user-service:3004" : "http://localhost:3004");
const CHAT_SERVICE_URL = process.env.CHAT_SERVICE_URL || "http://chat-service:3005";
// chat-service's /internal/push-notification validates against
// INTERNAL_API_SECRET || INTERNAL_SERVICE_SECRET (see its app.ts) - mirror the
// same precedence here so local dev (where the two are configured to
// DIFFERENT real values) and Lambda (where only INTERNAL_SERVICE_SECRET is
// ever set) both land on a value the receiving side actually accepts.
// BUG FIX (found Phase 13C-A, fixed Phase 14A/14B): this used to read ONLY
// INTERNAL_API_SECRET, which no Lambda here has ever been configured with -
// every call was silently sending an empty string as the auth header,
// always rejected by chat-service, always swallowed by the catch below.
// An earlier pass here had this flipped to INTERNAL_SERVICE_SECRET first,
// which the sibling user-service callers proved live (2026-10-08) breaks
// local dev, where the two are configured to different real values and
// chat-service's receiving side only ever checked INTERNAL_API_SECRET -
// aligned here to match that proven-correct order.
const CHAT_INTERNAL_SECRET =
  process.env.INTERNAL_API_SECRET || process.env.INTERNAL_SERVICE_SECRET || "";

export async function pushCycleAssessmentNotification(
  userId: string,
  cycleId: string,
  decision: string,
): Promise<void> {
  if (!CHAT_INTERNAL_SECRET) {
    // A missing secret is a configuration bug, not "chat-service is down" -
    // must stay observable and must never be sent as an empty/undefined
    // auth header (chat-service would just reject it anyway).
    logger.error(
      "[training-cycle] INTERNAL_SERVICE_SECRET/INTERNAL_API_SECRET not configured - skipping assessment-ready push to chat-service",
    );
    return;
  }
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
          // Drive-by fix (found while adding CYCLE_REASSESSMENT_READY
          // below): "/training-cycles/:id" has never been a real frontend
          // route (frontend/web has no such path — the cycle-assessment
          // review UI lives on /client/workout), so this real-time push's
          // click-through was silently dead ever since it was written.
          link: `/client/workout`,
          createdAt: new Date().toISOString(),
        },
      },
      {
        headers: { "x-internal-secret": CHAT_INTERNAL_SECRET },
        timeout: 3000,
      },
    );
  } catch (error) {
    const err = error as { message?: string; response?: { status?: number } };
    if (err?.response?.status === 401) {
      // Secret configured but rejected - the shared value is out of sync
      // between this service and chat-service. A real defect; must stay
      // observable, never collapsed into the generic "unreachable" case.
      logger.error(
        { status: err.response.status, userId, cycleId },
        "[training-cycle] chat-service rejected internal auth - INTERNAL_SERVICE_SECRET/INTERNAL_API_SECRET may be out of sync",
      );
      return;
    }
    // Best-effort — a missed real-time notification must never fail the
    // evaluate request itself (the assessment is already persisted).
    logger.warn(
      { err: err?.message, userId, cycleId },
      "[training-cycle] assessment-ready notification push failed",
    );
  }
}

export type WorkoutNotificationEventType =
  | "WORKOUT_UPCOMING"
  | "WORKOUT_RESCHEDULED"
  | "WORKOUT_UNFINISHED"
  | "TRAINING_PLAN_UPDATED"
  | "NUTRITION_PLAN_READY"
  | "CYCLE_REASSESSMENT_READY";

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
  const payload = {
    userId: params.userId,
    text: params.text,
    eventType: params.eventType,
    entityType:
      params.eventType === "TRAINING_PLAN_UPDATED"
        ? "TRAINING_PROGRAM"
        : params.eventType === "NUTRITION_PLAN_READY"
          ? "NUTRITION_PROGRAM"
          : params.eventType === "CYCLE_REASSESSMENT_READY"
            ? "TRAINING_CYCLE"
            : "WORKOUT_SCHEDULE",
    entityId: params.entityId,
    link: params.link,
  };

  try {
    if (process.env.USER_LAMBDA_NAME) {
      const response = await invokeHttpLambda({
        functionName: process.env.USER_LAMBDA_NAME,
        method: "POST",
        path: "/internal/notifications",
        headers: { "x-service-secret": process.env.INTERNAL_SERVICE_SECRET || "" },
        body: payload,
      });

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`User notification Lambda returned HTTP ${response.statusCode}`);
      }

      return;
    }

    await axios.post(
      `${USER_SERVICE_URL}/internal/notifications`,
      payload,
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
