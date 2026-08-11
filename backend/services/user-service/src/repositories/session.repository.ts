import { SessionStatus } from "../generated/prisma";
import { prisma } from "./profile.repository";

export const sessionRepository = {
  create: (data: {
    contractId: string;
    clientUserId: string;
    ptUserId: string;
    sessionMode?: string;
    scheduledStartAt: Date;
    scheduledEndAt: Date;
    location?: string;
    notes?: string;
  }) => prisma.session.create({ data: data as any }),

  findById: (id: string) =>
    prisma.session.findUnique({ where: { id }, include: { review: true } }),

  findByContract: (contractId: string) =>
    prisma.session.findMany({
      where: { contractId },
      orderBy: { scheduledStartAt: "asc" },
      include: { review: true },
    }),

  /** Upcoming sessions for a user (as either client or PT) */
  findUpcomingByUser: (userId: string) =>
    prisma.session.findMany({
      where: {
        OR: [{ clientUserId: userId }, { ptUserId: userId }],
        scheduledStartAt: { gte: new Date() },
        status: { in: [SessionStatus.REQUESTED, SessionStatus.CONFIRMED] },
      },
      orderBy: { scheduledStartAt: "asc" },
      include: { contract: true },
    }),

  updateStatus: (
    id: string,
    status: SessionStatus,
    extra?: Record<string, any>,
  ) =>
    prisma.session.update({
      where: { id },
      data: { status, ...extra },
    }),

  /**
   * Compare-and-swap on `sessionDeducted`: flips false → true and reports whether THIS
   * call was the one that flipped it. The filter is what makes quota deduction safe under
   * concurrency — a second confirm (or the auto-confirm sweep racing a manual confirm)
   * matches zero rows and must not touch the contract counter.
   */
  claimDeduction: async (id: string): Promise<boolean> => {
    const { count } = await prisma.session.updateMany({
      where: { id, sessionDeducted: false },
      data: { sessionDeducted: true },
    });
    return count === 1;
  },

  /** Sessions whose client-confirmation window has run out (drives the auto-confirm job). */
  findExpiredPendingConfirmation: (now: Date, limit = 100) =>
    prisma.session.findMany({
      where: {
        status: SessionStatus.PENDING_CLIENT_CONFIRMATION,
        clientConfirmDeadline: { lte: now },
      },
      orderBy: { clientConfirmDeadline: "asc" },
      take: limit,
    }),

  findByStatusForUser: (userId: string, statuses: SessionStatus[]) =>
    prisma.session.findMany({
      where: { clientUserId: userId, status: { in: statuses } },
      orderBy: { scheduledStartAt: "desc" },
      include: { contract: true },
    }),

  findDisputed: () =>
    prisma.session.findMany({
      where: { status: SessionStatus.DISPUTED },
      orderBy: { disputedAt: "asc" },
      include: { contract: true },
    }),

  /** Count non-terminal sessions for a contract (to enforce session limit) */
  countActiveByContract: (contractId: string) =>
    prisma.session.count({
      where: {
        contractId,
        status: { in: [SessionStatus.REQUESTED, SessionStatus.CONFIRMED] },
      },
    }),

  /** Check for overlapping sessions for a PT at a given time range.
   *  statuses defaults to [REQUESTED, CONFIRMED] for booking.
   *  Pass [CONFIRMED] only when confirming a session (BR-31). */
  findConflict: (
    ptUserId: string,
    startAt: Date,
    endAt: Date,
    excludeId?: string,
    statuses?: SessionStatus[],
  ) =>
    prisma.session.findFirst({
      where: {
        ptUserId,
        status: {
          in: statuses ?? [SessionStatus.REQUESTED, SessionStatus.CONFIRMED],
        },
        ...(excludeId && { id: { not: excludeId } }),
        scheduledStartAt: { lt: endAt },
        scheduledEndAt: { gt: startAt },
      },
    }),

  /** Full proposal history for one session, newest first — for dispute resolution. */
  findRescheduleRequestsBySession: (sessionId: string) =>
    prisma.sessionRescheduleRequest.findMany({
      where: { sessionId },
      orderBy: { createdAt: "desc" },
    }),

  /** The single open reschedule proposal for a session, if any (VĐ4: at most one). */
  findOpenRescheduleRequest: (sessionId: string) =>
    prisma.sessionRescheduleRequest.findFirst({
      where: { sessionId, status: "PENDING" },
    }),

  /** Moves already spent on this session, counting proposals from either side. */
  countAcceptedReschedules: (sessionId: string) =>
    prisma.sessionRescheduleRequest.count({
      where: { sessionId, status: "ACCEPTED" },
    }),

  /** Find all non-terminal sessions for a PT on a given date range */
  findConflictsByDate: (ptUserId: string, dayStart: Date, dayEnd: Date) =>
    prisma.session.findMany({
      where: {
        ptUserId,
        status: { in: [SessionStatus.REQUESTED, SessionStatus.CONFIRMED] },
        scheduledStartAt: { gte: dayStart, lte: dayEnd },
      },
    }),

  /** Create a session review */
  createReview: (data: {
    sessionId: string;
    contractId: string;
    clientUserId: string;
    rating: number;
    comment?: string;
  }) => prisma.sessionReview.create({ data }),

  /**
   * Batch: all booked sessions (REQUESTED|CONFIRMED) for multiple PTs within a date range.
   * Used by countAvailableSlotsForPTs to avoid N+1 queries when rendering a PT list.
   */
  findBookedByPTsAndRange: (ptUserIds: string[], from: Date, to: Date) =>
    prisma.session.findMany({
      where: {
        ptUserId: { in: ptUserIds },
        status: { in: [SessionStatus.REQUESTED, SessionStatus.CONFIRMED] },
        scheduledStartAt: { gte: from },
        scheduledEndAt: { lte: to },
      },
      select: { ptUserId: true, scheduledStartAt: true, scheduledEndAt: true },
    }),

  // ── Reschedule Request ──────────────────────────────────────────

  createRescheduleRequest: (data: any) =>
    prisma.sessionRescheduleRequest.create({ data }),

  findRescheduleRequestById: (id: string) =>
    prisma.sessionRescheduleRequest.findUnique({ where: { id }, include: { session: true } }),

  getRescheduleRequestsBySessionId: (sessionId: string) =>
    prisma.sessionRescheduleRequest.findMany({
      where: { sessionId },
      orderBy: { createdAt: "desc" },
    }),

  updateRescheduleRequestStatus: (
    id: string,
    status: string,
    responseNote?: string,
  ) =>
    prisma.sessionRescheduleRequest.update({
      where: { id },
      data: {
        status: status as any,
        respondedAt: new Date(),
        responseNote,
      },
    }),
};
