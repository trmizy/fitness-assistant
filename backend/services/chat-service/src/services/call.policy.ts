import axios from 'axios';
import { chatRepository } from '../repositories/chat.repository';

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3004';

/**
 * Chat-linked call: both users must be conversation participants,
 * and at least one user must be a PT OR an active contract must exist.
 * This matches the existing chat permission policy.
 */
export async function canInitiateCallFromChat(
  callerId: string,
  calleeId: string,
  conversationId: string,
  authToken: string,
): Promise<{ allowed: boolean; reason?: string }> {
  // 1. Both users are participants of the conversation
  const [callerOk, calleeOk] = await Promise.all([
    chatRepository.isUserParticipant(conversationId, callerId),
    chatRepository.isUserParticipant(conversationId, calleeId),
  ]);
  if (!callerOk || !calleeOk) {
    return { allowed: false, reason: 'Both users must be participants of this conversation' };
  }

  // 2. Check relationship: at least one is PT OR active contract exists
  try {
    const { data } = await axios.get(
      `${USER_SERVICE_URL}/contracts/check-relationship`,
      {
        params: { userAId: callerId, userBId: calleeId },
        headers: { Authorization: `Bearer ${authToken}` },
        timeout: 3000,
      },
    );
    if (!data.allowed) {
      return { allowed: false, reason: 'No PT relationship or active contract between users' };
    }
  } catch {
    // If user-service is down, be permissive (same pattern as chat.policy.ts)
    return { allowed: true };
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
): Promise<{ allowed: boolean; reason?: string; calleeId?: string; conversationId?: string }> {
  try {
    const { data: session } = await axios.get(
      `${USER_SERVICE_URL}/booking/sessions/${coachingSessionId}`,
      {
        headers: { Authorization: `Bearer ${authToken}` },
        timeout: 3000,
      },
    );

    if (!session) return { allowed: false, reason: 'Session not found' };
    if (session.status !== 'CONFIRMED') return { allowed: false, reason: 'Session is not confirmed' };
    if (session.sessionMode !== 'ONLINE' && session.sessionMode !== 'HYBRID') {
      return { allowed: false, reason: 'Session mode must be ONLINE or HYBRID' };
    }

    // Caller must be PT or client of this session
    if (session.ptUserId !== callerId && session.clientUserId !== callerId) {
      return { allowed: false, reason: 'You are not a participant of this session' };
    }

    // Time window check: startAt - 15min to endAt + 15min
    const now = Date.now();
    const start = new Date(session.scheduledStartAt).getTime();
    const end = new Date(session.scheduledEndAt).getTime();
    const windowStart = start - 15 * 60 * 1000;
    const windowEnd = end + 15 * 60 * 1000;

    if (now < windowStart || now > windowEnd) {
      return { allowed: false, reason: 'Outside the call time window for this session' };
    }

    const calleeId = callerId === session.ptUserId ? session.clientUserId : session.ptUserId;

    return { allowed: true, calleeId };
  } catch {
    return { allowed: false, reason: 'Failed to verify session' };
  }
}
