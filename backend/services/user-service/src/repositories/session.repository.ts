import { Prisma, SessionStatus } from "../generated/prisma";
import { prisma } from "./profile.repository";

/**
 * P0 cluster B2: every query below that participates in the booking race (quota count, PT
 * time-conflict check, session create) can be called either against the plain client (its
 * normal, unlocked use everywhere else — e.g. confirmSession's BR-31 check) or against a
 * `Prisma.TransactionClient` opened under an advisory lock (booking.service.ts's
 * withPtScheduleLock). Threading an optional db param through, defaulting to the singleton
 * client, means there is exactly one implementation of each query either way — the lock is
 * purely about WHICH connection runs it, never a second copy of the query itself.
 */
type Db = typeof prisma | Prisma.TransactionClient;

export const sessionRepository = {
  create: (
    data: {
      contractId: string;
      clientUserId: string;
      ptUserId: string;
      sessionMode?: string;
      scheduledStartAt: Date;
      scheduledEndAt: Date;
      location?: string;
      notes?: string;
    },
    db: Db = prisma,
  ) => db.session.create({ data: data as any }),

  findById: (id: string) =>
    prisma.session.findUnique({
      where: { id },
      include: { review: true, clientReview: true },
    }),

  findByContract: (contractId: string) =>
    prisma.session.findMany({
      where: { contractId },
      orderBy: { scheduledStartAt: "asc" },
      include: { review: true, clientReview: true },
    }),

  /** Upcoming sessions for a user (as either client or PT) */
  findUpcomingByUser: (userId: string) =>
    prisma.session.findMany({
      where: {
        OR: [{ clientUserId: userId }, { ptUserId: userId }],
        // Filtering on scheduledStartAt used to mean a session vanished from "My
        // Schedule"/"upcoming" the instant its start time arrived — even while it was
        // still running (an ONLINE session's join window stays open well past its start,
        // see call.policy.ts). Filtering on the END time instead keeps a session in this
        // list for its whole duration, only dropping off once it's actually over.
        scheduledEndAt: { gte: new Date() },
        status: { in: [SessionStatus.REQUESTED, SessionStatus.CONFIRMED] },
      },
      orderBy: { scheduledStartAt: "asc" },
      include: {
        contract: true,
        // Money-flow plan 3.3: the accept/reject reschedule UI reads `s.rescheduleRequests`,
        // but this list never included it — the field was always undefined, so the buttons
        // silently never rendered for anyone. At most one PENDING request per session (VĐ4).
        rescheduleRequests: { where: { status: "PENDING" }, orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),

  updateStatus: (
    id: string,
    status: SessionStatus,
    extra?: Record<string, any>,
    db: Db = prisma,
  ) =>
    db.session.update({
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

  /**
   * Vòng 4 / Phase A — general-purpose version of the same CAS shape claimDeduction above
   * uses for `sessionDeducted`, but for `status`. `updateStatus` above is a plain
   * `db.session.update({ where: { id } })` — no status precondition at all, so two
   * concurrent callers that both read the same starting status both "win" and both run
   * their side effects (this is exactly how cancelSession could double-deduct quota).
   * `updateMany`'s where-clause makes the precondition atomic with the write: only a caller
   * whose expected status still matches what's in the row RIGHT NOW gets `count === 1` and
   * may proceed to run side effects; every other concurrent caller gets `false` and must
   * treat this as "already handled by someone else", not retry the same write.
   */
  transitionStatus: async (
    id: string,
    expected: SessionStatus[],
    next: SessionStatus,
    extra?: Record<string, any>,
    db: Db = prisma,
  ): Promise<boolean> => {
    const { count } = await db.session.updateMany({
      where: { id, status: { in: expected } },
      data: { status: next, ...extra },
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

  /** Money-flow plan 4.3: the PT-side equivalent of findByStatusForUser — a session waiting
   * on the PT's response (e.g. PT_NO_SHOW_REPORTED) does not show in findUpcomingByUser once
   * its scheduledStartAt has passed, so this is a separate, time-unfiltered lookup. */
  findByStatusForPT: (ptUserId: string, statuses: SessionStatus[]) =>
    prisma.session.findMany({
      where: { ptUserId, status: { in: statuses } },
      orderBy: { scheduledStartAt: "desc" },
      include: { contract: true },
    }),

  findDisputed: () =>
    prisma.session.findMany({
      where: { status: SessionStatus.DISPUTED },
      orderBy: { disputedAt: "asc" },
      include: { contract: true },
    }),

  /**
   * Count sessions that still hold an entitlement against a contract (to enforce the session
   * limit). P0 cluster B1: used to only count REQUESTED/CONFIRMED — PENDING_CLIENT_CONFIRMATION,
   * DISPUTED, and PT_NO_SHOW_REPORTED also still hold a claim on the contract's quota (nothing
   * has released or refunded that slot yet), so a client could book past their purchased count
   * while another of their sessions sat in one of those three states waiting on a response.
   * COMPLETED/CANCELLED/NO_SHOW are excluded on purpose: each of those has already been
   * accounted for elsewhere (usedSessions, compensatedSessions, or simply never happened).
   */
  countActiveByContract: (contractId: string, db: Db = prisma) =>
    db.session.count({
      where: {
        contractId,
        status: {
          in: [
            SessionStatus.REQUESTED,
            SessionStatus.CONFIRMED,
            SessionStatus.PENDING_CLIENT_CONFIRMATION,
            SessionStatus.DISPUTED,
            SessionStatus.PT_NO_SHOW_REPORTED,
          ],
        },
      },
    }),

  /** Vòng 4 / Phase E2 — how many sessions on this contract were NO_SHOW through the PT's own
   * fault (self-admitted, agreed to the client's report, or admin-confirmed) — see the
   * ptAtFault field's own doc comment in schema.prisma. Feeds the client's right to terminate
   * for repeated PT no-shows (3+), enforced server-side in contract.controller.ts's
   * terminate(), never trusted from the caller. */
  countPtAtFaultByContract: (contractId: string) =>
    prisma.session.count({ where: { contractId, ptAtFault: true } }),

  /** Check for overlapping sessions for a PT at a given time range.
   *  statuses defaults to [REQUESTED, CONFIRMED] for booking.
   *  Pass [CONFIRMED] only when confirming a session (BR-31). */
  findConflict: (
    ptUserId: string,
    startAt: Date,
    endAt: Date,
    excludeId?: string,
    statuses?: SessionStatus[],
    db: Db = prisma,
  ) =>
    db.session.findFirst({
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

  /** Create a session review (client rating the PT) */
  createReview: (data: {
    sessionId: string;
    contractId: string;
    clientUserId: string;
    rating: number;
    comment?: string;
  }) => prisma.sessionReview.create({ data }),

  /** Create a client review (PT rating the client) — the mirror-image of createReview above. */
  createClientReview: (data: {
    sessionId: string;
    contractId: string;
    ptUserId: string;
    rating: number;
    comment?: string;
  }) => prisma.clientReview.create({ data }),

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
    db: Db = prisma,
  ) =>
    db.sessionRescheduleRequest.update({
      where: { id },
      data: {
        status: status as any,
        respondedAt: new Date(),
        responseNote,
      },
    }),
};
