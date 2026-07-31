/**
 * Real-time notification push, reusing the exact cross-service chain
 * user-service's notification.service.ts already uses (fitness-service has
 * no user-facing socket connection of its own): a plain HTTP POST to
 * chat-service's internal endpoint, which emits a socket.io event to the
 * user's room. No new infrastructure (no queue/bus) — matches the spec's
 * "không thêm Kafka hoặc dịch vụ hạ tầng lớn cho chức năng này".
 *
 * Known gap: unlike user-service's flow, this does NOT also persist a
 * Notification row (that table lives in user-service's own DB, and nothing
 * in this repo does a fitness-service -> user-service WRITE call today).
 * The notification is real-time-only: delivered if the user is connected,
 * not retrievable later from a notification history/list. Acceptable for
 * this feature's first pass — flagged here rather than silently accepted.
 */
import axios from "axios";
import { logger } from "@gym-coach/shared";

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
