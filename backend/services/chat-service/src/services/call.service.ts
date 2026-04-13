import { CallStatus, CallType, CallOrigin } from '@prisma/client';
import { callRepository } from '../repositories/call.repository';

export const callService = {
  async initiateCall(data: {
    conversationId: string;
    callerId: string;
    calleeId: string;
    callType: CallType;
    origin?: CallOrigin;
    coachingSessionId?: string;
  }) {
    // Check if either party is already in a call
    const [callerBusy, calleeBusy] = await Promise.all([
      callRepository.findActiveCallForUser(data.callerId),
      callRepository.findActiveCallForUser(data.calleeId),
    ]);

    if (callerBusy) {
      return { error: 'You are already in a call' };
    }
    if (calleeBusy) {
      return { error: 'User is busy' };
    }

    // For session-linked calls, check if there's already an active call for this session
    if (data.origin === 'SESSION' && data.coachingSessionId) {
      const existing = await callRepository.findActiveByCoachingSession(data.coachingSessionId);
      if (existing) {
        return { existingCall: existing };
      }
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
    if (!call) return { error: 'Call not found' };
    if (call.calleeId !== userId) return { error: 'Not authorized' };

    // First-accept-wins: check status is still RINGING (atomic guard for multi-tab)
    if (call.status !== CallStatus.RINGING) {
      return { error: 'Call is no longer ringing', alreadyHandled: true };
    }

    const updated = await callRepository.updateStatus(callSessionId, CallStatus.ACCEPTED, {
      answeredAt: new Date(),
    });
    return { call: updated };
  },

  async rejectCall(callSessionId: string, userId: string) {
    const call = await callRepository.findById(callSessionId);
    if (!call) return { error: 'Call not found' };
    if (call.calleeId !== userId) return { error: 'Not authorized' };
    if (call.status !== CallStatus.RINGING) return { error: 'Call is no longer ringing' };

    const updated = await callRepository.updateStatus(callSessionId, CallStatus.REJECTED, {
      endedAt: new Date(),
      endReason: 'rejected',
    });
    return { call: updated };
  },

  async cancelCall(callSessionId: string, userId: string) {
    const call = await callRepository.findById(callSessionId);
    if (!call) return { error: 'Call not found' };
    if (call.callerId !== userId) return { error: 'Not authorized' };
    if (call.status !== CallStatus.RINGING && call.status !== CallStatus.INITIATING) {
      return { error: 'Call cannot be cancelled in current state' };
    }

    const updated = await callRepository.updateStatus(callSessionId, CallStatus.CANCELLED, {
      endedAt: new Date(),
      endReason: 'cancelled',
    });
    return { call: updated };
  },

  async endCall(callSessionId: string, userId: string, reason?: string) {
    const call = await callRepository.findById(callSessionId);
    if (!call) return { error: 'Call not found' };
    if (call.callerId !== userId && call.calleeId !== userId) return { error: 'Not authorized' };

    const activeStates: CallStatus[] = [
      CallStatus.ACCEPTED, CallStatus.CONNECTING, CallStatus.ACTIVE,
    ];
    if (!activeStates.includes(call.status)) {
      return { error: 'Call is not in an active state' };
    }

    const updated = await callRepository.updateStatus(callSessionId, CallStatus.ENDED, {
      endedAt: new Date(),
      endReason: reason || 'hangup',
    });
    return { call: updated };
  },

  async markMissed(callSessionId: string) {
    const call = await callRepository.findById(callSessionId);
    if (!call || call.status !== CallStatus.RINGING) return null;

    return callRepository.updateStatus(callSessionId, CallStatus.MISSED, {
      endedAt: new Date(),
      endReason: 'no_answer',
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
