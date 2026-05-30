import { Response } from 'express';
import { logger } from '@gym-coach/shared';
import { CallType, CallOrigin } from '@prisma/client';
import { callService } from '../services/call.service';
import { canInitiateCallFromChat, canInitiateCallFromSession } from '../services/call.policy';
import { chatRepository } from '../repositories/chat.repository';
import type { AuthRequest } from '../middleware/auth.middleware';

// Map service-level error strings to clean HTTP statuses.
function mapServiceError(err: string): { status: number; message: string } {
  if (/already in a call/i.test(err)) return { status: 409, message: err };
  if (/busy/i.test(err)) return { status: 409, message: err };
  if (/not authorized/i.test(err)) return { status: 403, message: err };
  if (/not found/i.test(err)) return { status: 404, message: err };
  if (/no longer ringing|cannot be cancelled|not in an active state/i.test(err)) return { status: 409, message: err };
  return { status: 400, message: err };
}

export const callController = {
  // POST /chat/calls
  // Body: { receiverId, callType: 'VOICE'|'VIDEO', conversationId?, coachingSessionId?, origin? }
  async create(req: AuthRequest, res: Response) {
    try {
      const callerId = req.user?.id;
      if (!callerId) return res.status(401).json({ error: 'Unauthorized' });

      const { receiverId, callType, conversationId, coachingSessionId, origin } = req.body || {};
      const calleeId = receiverId;
      const type = (callType || '').toString().toUpperCase();
      if (!calleeId) return res.status(400).json({ error: 'receiverId is required' });
      if (!['VOICE', 'VIDEO'].includes(type)) {
        return res.status(400).json({ error: "callType must be 'VOICE' or 'VIDEO'" });
      }

      const callOrigin: CallOrigin = origin === 'SESSION' ? CallOrigin.SESSION : CallOrigin.CHAT;
      const authToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');

      // Authorization gate — beyond just caller==auth user. Either a real conversation
      // exists between the two, or a confirmed online coaching session is in window.
      if (callOrigin === CallOrigin.CHAT) {
        // Prefer the conversation id supplied by caller; otherwise auto-find one.
        let convId = conversationId;
        if (!convId) {
          const existing = await chatRepository.findExistingDirectConversation(callerId, calleeId);
          convId = existing?.id;
        }
        if (!convId) {
          return res.status(403).json({ error: 'No conversation between caller and receiver' });
        }
        const verdict = await canInitiateCallFromChat(callerId, calleeId, convId, authToken);
        if (!verdict.allowed) return res.status(403).json({ error: verdict.reason || 'Not allowed' });

        const result = await callService.initiateCall({
          conversationId: convId,
          callerId,
          calleeId,
          callType: type as CallType,
          origin: callOrigin,
        });
        if (result.error) {
          const mapped = mapServiceError(result.error);
          return res.status(mapped.status).json({ error: mapped.message });
        }
        return res.status(201).json({ call: result.call ?? result.existingCall });
      }

      // SESSION-origin call
      if (!coachingSessionId) {
        return res.status(400).json({ error: 'coachingSessionId is required for session-origin calls' });
      }
      const sessionVerdict = await canInitiateCallFromSession(callerId, coachingSessionId, authToken);
      if (!sessionVerdict.allowed) return res.status(403).json({ error: sessionVerdict.reason || 'Not allowed' });
      const result = await callService.initiateCall({
        callerId,
        calleeId: sessionVerdict.calleeId || calleeId,
        callType: type as CallType,
        origin: callOrigin,
        coachingSessionId,
      });
      if (result.error) {
        const mapped = mapServiceError(result.error);
        return res.status(mapped.status).json({ error: mapped.message });
      }
      return res.status(201).json({ call: result.call ?? result.existingCall });
    } catch (error: any) {
      logger.error(error, 'Create call error');
      return res.status(500).json({ error: 'Failed to create call' });
    }
  },

  // PATCH /chat/calls/:id/accept
  async accept(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const result = await callService.acceptCall(req.params.id, userId);
      if (result.error) {
        const mapped = mapServiceError(result.error);
        return res.status(mapped.status).json({ error: mapped.message });
      }
      return res.json({ call: result.call });
    } catch (error: any) {
      logger.error(error, 'Accept call error');
      return res.status(500).json({ error: 'Failed to accept call' });
    }
  },

  // PATCH /chat/calls/:id/end
  async end(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const reason = req.body?.reason;
      // If the call is still RINGING (callee never picked up) treat as cancel/reject;
      // otherwise it's a real hangup of an active call.
      const current = await callService.findById(req.params.id);
      if (!current) return res.status(404).json({ error: 'Call not found' });
      let result: any;
      if (current.status === 'RINGING' || current.status === 'INITIATING') {
        result = current.callerId === userId
          ? await callService.cancelCall(req.params.id, userId)
          : await callService.rejectCall(req.params.id, userId);
      } else {
        result = await callService.endCall(req.params.id, userId, reason);
      }
      if (result.error) {
        const mapped = mapServiceError(result.error);
        return res.status(mapped.status).json({ error: mapped.message });
      }
      return res.json({ call: result.call });
    } catch (error: any) {
      logger.error(error, 'End call error');
      return res.status(500).json({ error: 'Failed to end call' });
    }
  },
};
