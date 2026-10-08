import axios from "axios";
import { logger } from "@gym-coach/shared";

const CHAT_SERVICE_URL = process.env.CHAT_SERVICE_URL || "http://chat-service:3005";
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || "";

/**
 * Best-effort, fire-and-forget: tells chat-service to force-end any lingering CallSession row
 * for this coaching session, now that its room is over. chat-service's WebRTC signaling layer
 * has no other way to learn this happened (it never sees Session rows), and an open room's row
 * is deliberately never ended by someone leaving or disconnecting.
 *
 * It must run on EVERY path that takes an online session out of CONFIRMED, not only the
 * room-close sweep: a trainer who pressed "complete" two minutes after the end (before the
 * sweep's next tick) left the row active forever, and both people were then refused every later
 * call — and the room of their next session — with "You are already in a call" (real phone,
 * 7/10). Never awaited: it must not delay or fail the session's own settlement.
 */
export function endOpenRoomCall(coachingSessionId: string, reason: string): void {
  axios
    .post(
      `${CHAT_SERVICE_URL}/internal/calls/end-by-session`,
      { coachingSessionId, reason },
      { timeout: 3000, headers: { "x-internal-secret": INTERNAL_API_SECRET } },
    )
    .catch((err) =>
      logger.warn({ err: err.message, coachingSessionId }, "Failed to end lingering call for a closed room"),
    );
}
