import { prisma } from "./chat.repository";
import type { CallSessionEvidenceRow } from "../routes/internal-evidence.routes";

/** Read-only. Selects exactly the evidence fields (never the conversation, never message content). */
export const internalEvidenceRepository = {
  findCallSessionsByCoachingSession: (coachingSessionId: string, take: number): Promise<CallSessionEvidenceRow[]> =>
    prisma.callSession.findMany({
      where: { coachingSessionId },
      select: { id: true, status: true, startedAt: true, answeredAt: true, endedAt: true, endReason: true, callerId: true, calleeId: true, origin: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take,
    }),
};
