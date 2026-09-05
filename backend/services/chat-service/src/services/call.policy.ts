import axios from "axios";
import { chatRepository } from "../repositories/chat.repository";

const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL || "http://localhost:3004";

/**
 * Chat-linked call: both users must be conversation participants,
 * and neither account may be deactivated/blocked.
 * Contract is NOT required — any two users who can see each other in a
 * conversation can call each other (same as the chat discovery policy).
 */
export async function canInitiateCallFromChat(
  callerId: string,
  calleeId: string,
  conversationId: string,
  authToken: string,
): Promise<{ allowed: boolean; reason?: string }> {
  // Both users are participants of the conversation
  const [callerOk, calleeOk] = await Promise.all([
    chatRepository.isUserParticipant(conversationId, callerId),
    chatRepository.isUserParticipant(conversationId, calleeId),
  ]);
  if (!callerOk || !calleeOk) {
    return {
      allowed: false,
      reason: "Both users must be participants of this conversation",
    };
  }

  // Check that neither account is deactivated/blocked via user-service
  try {
    const { data } = await axios.get(
      `${USER_SERVICE_URL}/contracts/check-relationship`,
      {
        params: { userAId: callerId, userBId: calleeId },
        headers: { Authorization: `Bearer ${authToken}` },
        timeout: 3000,
      },
    );
    // allowed === false only means one account is inactive/blocked
    if (data.blocked) {
      return { allowed: false, reason: "One or both accounts are deactivated" };
    }
  } catch {
    // If user-service is down, be permissive
  }

  return { allowed: true };
}

/**
 * Session-linked call: coaching session must be CONFIRMED, ONLINE/HYBRID,
 * caller must be a party, and current time within the call window.
 * (Phase 1c — placeholder for now)
 */
export async function canInitiateCallFromSession(
  callerId: string,
  coachingSessionId: string,
  authToken: string,
): Promise<{
  allowed: boolean;
  reason?: string;
  calleeId?: string;
  conversationId?: string;
}> {
  try {
    const { data: session } = await axios.get(
      `${USER_SERVICE_URL}/sessions/${coachingSessionId}`,
      {
        headers: { Authorization: `Bearer ${authToken}` },
        timeout: 3000,
      },
    );

    if (!session) return { allowed: false, reason: "Session not found" };
    if (session.status !== "CONFIRMED")
      return { allowed: false, reason: "Session is not confirmed" };
    if (session.sessionMode !== "ONLINE" && session.sessionMode !== "HYBRID") {
      return {
        allowed: false,
        reason: "Session mode must be ONLINE or HYBRID",
      };
    }

    // Caller must be PT or client of this session
    if (session.ptUserId !== callerId && session.clientUserId !== callerId) {
      return {
        allowed: false,
        reason: "You are not a participant of this session",
      };
    }

    // Open-room redesign: the "meeting room" window this must agree with lives in
    // user-service's booking.service.ts (ROOM_OPEN_BEFORE_MINUTES, hard close at
    // scheduledEndAt with no grace tail — a room mid-sentence is cut exactly like a real
    // Meet/Teams call would be). Same env var name on purpose, so ops sets one number, not
    // two independently-drifting ones. This check is defense-in-depth behind the signed
    // joinToken (already minted only inside that same window) — it must never be STRICTER
    // than the window that already handed out the token, or a legitimately-issued token
    // could get rejected here on every subsequent rejoin.
    const roomOpenBeforeMs =
      Number(process.env.ROOM_OPEN_BEFORE_MINUTES ?? "15") * 60 * 1000;
    const now = Date.now();
    const windowStart =
      new Date(session.scheduledStartAt).getTime() - roomOpenBeforeMs;
    const windowEnd = new Date(session.scheduledEndAt).getTime();
    if (now < windowStart || now >= windowEnd) {
      return {
        allowed: false,
        reason: "Outside the call time window for this session",
      };
    }

    const calleeId =
      callerId === session.ptUserId ? session.clientUserId : session.ptUserId;

    return { allowed: true, calleeId };
  } catch {
    return { allowed: false, reason: "Failed to verify session" };
  }
}
