import { CallStatus, CallType, CallOrigin } from "@prisma/client";
import { prisma } from "./chat.repository";

export const callRepository = {
  create: (data: {
    conversationId?: string;
    callerId: string;
    calleeId: string;
    callType: CallType;
    status?: CallStatus;
    origin?: CallOrigin;
    coachingSessionId?: string;
  }) =>
    prisma.callSession.create({
      data: {
        ...data,
        // Prisma v5 requires explicit null (not undefined) for optional relation scalars;
        // undefined triggers a "Argument `conversation` is missing" validation error.
        conversationId: data.conversationId ?? null,
      },
    }),

  findById: (id: string) => prisma.callSession.findUnique({ where: { id } }),

  updateStatus: (id: string, status: CallStatus, extra?: Record<string, any>) =>
    prisma.callSession.update({
      where: { id },
      data: { status, ...extra },
    }),

  /**
   * A participant's peer connection reached "connected". The FIRST report stamps `startedAt`
   * (the duration shown in the call-log message is measured from here); later reports — the
   * other side's, or a renegotiation after an open-room rejoin — only lift the status back to
   * ACTIVE and never move `startedAt`. Conditional updates, so two simultaneous reports can't
   * both win. Terminal rows (ENDED, MISSED, …) are never touched.
   */
  markConnected: async (id: string, at: Date = new Date()) => {
    const first = await prisma.callSession.updateMany({
      where: { id, startedAt: null, status: { in: ["ACCEPTED", "CONNECTING", "ACTIVE"] } },
      data: { status: "ACTIVE", startedAt: at },
    });
    if (first.count > 0) return { started: true };
    await prisma.callSession.updateMany({
      where: { id, status: { in: ["ACCEPTED", "CONNECTING"] } },
      data: { status: "ACTIVE" },
    });
    return { started: false };
  },

  /**
   * Mobile E2 — the CHAT call still ringing for this callee, if any (newest first). A phone that
   * was woken by the "đang gọi" push connects after the ring went out; it asks for this.
   */
  findRingingChatCallForCallee: (calleeId: string, since: Date) =>
    prisma.callSession.findFirst({
      where: { calleeId, status: "RINGING", origin: "CHAT", createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
    }),

  /** Find any non-terminal call for a user (as caller or callee) */
  findActiveCallForUser: (userId: string) =>
    prisma.callSession.findFirst({
      where: {
        OR: [{ callerId: userId }, { calleeId: userId }],
        status: {
          in: ["INITIATING", "RINGING", "ACCEPTED", "CONNECTING", "ACTIVE"],
        },
      },
    }),

  /** Find call history for a conversation */
  findByConversationId: (conversationId: string, take = 50) =>
    prisma.callSession.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take,
    }),

  /** Find active/ringing call for a coaching session (for session-linked auto-join) */
  findActiveByCoachingSession: (coachingSessionId: string) =>
    prisma.callSession.findFirst({
      where: {
        coachingSessionId,
        status: { in: ["RINGING", "ACCEPTED", "CONNECTING", "ACTIVE"] },
      },
    }),
};
