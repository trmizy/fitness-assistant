import { CallStatus, CallType, CallOrigin } from '@prisma/client';
import { prisma } from './chat.repository';

export const callRepository = {
  create: (data: {
    conversationId: string;
    callerId: string;
    calleeId: string;
    callType: CallType;
    status?: CallStatus;
    origin?: CallOrigin;
    coachingSessionId?: string;
  }) =>
    prisma.callSession.create({ data }),

  findById: (id: string) =>
    prisma.callSession.findUnique({ where: { id } }),

  updateStatus: (id: string, status: CallStatus, extra?: Record<string, any>) =>
    prisma.callSession.update({
      where: { id },
      data: { status, ...extra },
    }),

  /** Find any non-terminal call for a user (as caller or callee) */
  findActiveCallForUser: (userId: string) =>
    prisma.callSession.findFirst({
      where: {
        OR: [{ callerId: userId }, { calleeId: userId }],
        status: { in: ['INITIATING', 'RINGING', 'ACCEPTED', 'CONNECTING', 'ACTIVE'] },
      },
    }),

  /** Find call history for a conversation */
  findByConversationId: (conversationId: string, take = 50) =>
    prisma.callSession.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take,
    }),

  /** Find active/ringing call for a coaching session (for session-linked auto-join) */
  findActiveByCoachingSession: (coachingSessionId: string) =>
    prisma.callSession.findFirst({
      where: {
        coachingSessionId,
        status: { in: ['RINGING', 'ACCEPTED', 'CONNECTING', 'ACTIVE'] },
      },
    }),
};
