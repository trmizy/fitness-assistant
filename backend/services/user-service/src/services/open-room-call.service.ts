import axios from "axios";
import { logger } from "@gym-coach/shared";

const CHAT_SERVICE_URL = process.env.CHAT_SERVICE_URL || "http://chat-service:3005";
// Same precedence as notification.service.ts's pushToSocket (see its
// comment) — chat-service's receiving side checks
// INTERNAL_API_SECRET || INTERNAL_SERVICE_SECRET, so this must send
// whichever of the two it finds in that same order. An earlier pass had
// this backwards (INTERNAL_SERVICE_SECRET first), which 401'd on local dev
// where the two are configured to different real values — confirmed live
// via a real "PT completes session" call (2026-10-08) that logged
// "chat-service rejected internal auth" and left the CallSession row open,
// reproducing the exact "You are already in a call" symptom.
const CHAT_INTERNAL_SECRET =
  process.env.INTERNAL_API_SECRET || process.env.INTERNAL_SERVICE_SECRET || "";

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
  if (!CHAT_INTERNAL_SECRET) {
    logger.error(
      "[open-room-call] INTERNAL_SERVICE_SECRET/INTERNAL_API_SECRET not configured - skipping chat-service call-end notice",
    );
    return;
  }
  axios
    .post(
      `${CHAT_SERVICE_URL}/internal/calls/end-by-session`,
      { coachingSessionId, reason },
      { timeout: 3000, headers: { "x-internal-secret": CHAT_INTERNAL_SECRET } },
    )
    .catch((err) => {
      if (err?.response?.status === 401) {
        logger.error(
          { status: err.response.status, coachingSessionId },
          "[open-room-call] chat-service rejected internal auth - INTERNAL_SERVICE_SECRET/INTERNAL_API_SECRET may be out of sync",
        );
        return;
      }
      logger.warn({ err: err?.message, coachingSessionId }, "Failed to end lingering call for a closed room");
    });
}
