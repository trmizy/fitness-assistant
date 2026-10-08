import { CallStatus, CallType, CallOrigin } from "@prisma/client";
import { callRepository } from "../repositories/call.repository";

/**
 * How long an online session's room can possibly live: it opens 15 minutes before a session
 * that lasts at most 4 hours. A SESSION call row older than this is not a room any more.
 */
const SESSION_ROOM_MAX_AGE_MS = Number(process.env.SESSION_ROOM_MAX_AGE_HOURS ?? "6") * 60 * 60 * 1000;

/** A room row nobody ended (user-service's "this session is over" notice never arrived). */
export function isAbandonedRoomCall(
  call: { origin: CallOrigin | string; createdAt: Date },
  now: number = Date.now(),
): boolean {
  return call.origin === "SESSION" && now - call.createdAt.getTime() > SESSION_ROOM_MAX_AGE_MS;
}

/**
 * The call that really keeps this user busy, if any. A room row is never ended by its people
 * leaving, so one that outlived its session used to make both of them "already in a call" for
 * good — it is ended here instead of being believed.
 */
async function findBlockingCall(userId: string) {
  for (let i = 0; i < 5; i++) {
    const call = await callRepository.findActiveCallForUser(userId);
    if (!call || !isAbandonedRoomCall(call)) return call;
    await callRepository.updateStatus(call.id, CallStatus.ENDED, {
      endedAt: new Date(),
      endReason: "room_abandoned",
    });
  }
  return callRepository.findActiveCallForUser(userId);
}

export const callService = {
  async initiateCall(data: {
    conversationId?: string;
    callerId: string;
    calleeId: string;
    callType: CallType;
    origin?: CallOrigin;
    coachingSessionId?: string;
  }) {
    // Open-room redesign: rejoining (or being the second arrival into) THIS session's own
    // room must never trip the busy-check below — an open room's row deliberately stays
    // "active" after someone leaves (see call:leave_room), so the very account rejoining it
    // is *always* found by findActiveCallForUser as already a participant of this exact row.
    // Checked first and unconditionally short-circuits: whether this is the row's original
    // caller coming back, or the callee arriving for the first or the fifth time, it's the
    // same row, never a genuine new call.
    if (data.origin === "SESSION" && data.coachingSessionId) {
      const existing = await callRepository.findActiveByCoachingSession(
        data.coachingSessionId,
      );
      if (existing) {
        return { existingCall: existing };
      }
    }

    // Check if either party is already in a call — a genuinely different, unrelated one, now
    // that a rejoin into this same session's own room was already handled above.
    const [callerBusy, calleeBusy] = await Promise.all([
      findBlockingCall(data.callerId),
      findBlockingCall(data.calleeId),
    ]);

    if (callerBusy) {
      return { error: "You are already in a call" };
    }
    if (calleeBusy) {
      return { error: "User is busy" };
    }

    const call = await callRepository.create({
      conversationId: data.conversationId,
      callerId: data.callerId,
      calleeId: data.calleeId,
      callType: data.callType,
      status: CallStatus.RINGING,
      origin: data.origin || CallOrigin.CHAT,
      coachingSessionId: data.coachingSessionId,
    });

    return { call };
  },

  async acceptCall(callSessionId: string, userId: string) {
    const call = await callRepository.findById(callSessionId);
    if (!call) return { error: "Call not found" };
    if (call.calleeId !== userId) return { error: "Not authorized" };

    // First-accept-wins: check status is still RINGING (atomic guard for multi-tab)
    if (call.status !== CallStatus.RINGING) {
      return { error: "Call is no longer ringing", alreadyHandled: true };
    }

    const updated = await callRepository.updateStatus(
      callSessionId,
      CallStatus.ACCEPTED,
      {
        answeredAt: new Date(),
      },
    );
    return { call: updated };
  },

  async rejectCall(callSessionId: string, userId: string) {
    const call = await callRepository.findById(callSessionId);
    if (!call) return { error: "Call not found" };
    if (call.calleeId !== userId) return { error: "Not authorized" };
    if (call.status !== CallStatus.RINGING)
      return { error: "Call is no longer ringing" };

    const updated = await callRepository.updateStatus(
      callSessionId,
      CallStatus.REJECTED,
      {
        endedAt: new Date(),
        endReason: "rejected",
      },
    );
    return { call: updated };
  },

  async cancelCall(callSessionId: string, userId: string) {
    const call = await callRepository.findById(callSessionId);
    if (!call) return { error: "Call not found" };
    if (call.callerId !== userId) return { error: "Not authorized" };
    if (
      call.status !== CallStatus.RINGING &&
      call.status !== CallStatus.INITIATING
    ) {
      return { error: "Call cannot be cancelled in current state" };
    }

    const updated = await callRepository.updateStatus(
      callSessionId,
      CallStatus.CANCELLED,
      {
        endedAt: new Date(),
        endReason: "cancelled",
      },
    );
    return { call: updated };
  },

  async endCall(callSessionId: string, userId: string, reason?: string) {
    const call = await callRepository.findById(callSessionId);
    if (!call) return { error: "Call not found" };
    if (call.callerId !== userId && call.calleeId !== userId)
      return { error: "Not authorized" };

    const activeStates: CallStatus[] = [
      CallStatus.ACCEPTED,
      CallStatus.CONNECTING,
      CallStatus.ACTIVE,
    ];
    if (!activeStates.includes(call.status)) {
      return { error: "Call is not in an active state" };
    }

    const updated = await callRepository.updateStatus(
      callSessionId,
      CallStatus.ENDED,
      {
        endedAt: new Date(),
        endReason: reason || "hangup",
      },
    );
    return { call: updated };
  },

  async markMissed(callSessionId: string) {
    const call = await callRepository.findById(callSessionId);
    if (!call || call.status !== CallStatus.RINGING) return null;

    return callRepository.updateStatus(callSessionId, CallStatus.MISSED, {
      endedAt: new Date(),
      endReason: "no_answer",
    });
  },

  /**
   * Open-room sessions: a lingering CallSession row for a coaching session whose own time
   * window has just closed (per user-service's room-close-resolution sweep) is force-ended
   * here — its real-world resolution already happened without this side ever being told, and
   * a stale ACTIVE/CONNECTING row would otherwise sit there forever, wrongly counting as
   * "already in a call" for findActiveCallForUser on a LATER, unrelated session for the same
   * PT or client (e.g. back-to-back bookings). Not authorized by any user — this is a
   * system/internal cleanup call, not something either party can trigger on their own.
   */
  async endCallsForCoachingSession(coachingSessionId: string, reason: string) {
    const call = await callRepository.findActiveByCoachingSession(coachingSessionId);
    if (!call) return null;
    return callRepository.updateStatus(call.id, CallStatus.ENDED, {
      endedAt: new Date(),
      endReason: reason,
    });
  },

  async markFailed(callSessionId: string, reason: string) {
    const call = await callRepository.findById(callSessionId);
    if (!call) return null;

    return callRepository.updateStatus(callSessionId, CallStatus.FAILED, {
      endedAt: new Date(),
      endReason: reason,
    });
  },

  async setConnecting(callSessionId: string) {
    return callRepository.updateStatus(callSessionId, CallStatus.CONNECTING);
  },

  /**
   * Called when a participant's WebRTC connection reports "connected" (`call:connected`). Only
   * the call's own caller/callee count; see callRepository.markConnected for first-wins.
   */
  async markConnected(callSessionId: string, userId: string) {
    const call = await callRepository.findById(callSessionId);
    if (!call) return { error: "Call not found" };
    if (call.callerId !== userId && call.calleeId !== userId) return { error: "Not authorized" };
    return callRepository.markConnected(callSessionId);
  },

  async setActive(callSessionId: string) {
    return callRepository.updateStatus(callSessionId, CallStatus.ACTIVE, {
      startedAt: new Date(),
    });
  },

  async findById(callSessionId: string) {
    return callRepository.findById(callSessionId);
  },

  async findActiveCallForUser(userId: string) {
    return callRepository.findActiveCallForUser(userId);
  },
};
