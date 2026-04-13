import { SessionStatus } from '../generated/prisma';
import { prisma } from './profile.repository';

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
  }) =>
    prisma.session.create({ data: data as any }),

  findById: (id: string) =>
    prisma.session.findUnique({ where: { id }, include: { review: true } }),

  findByContract: (contractId: string) =>
    prisma.session.findMany({
      where: { contractId },
      orderBy: { scheduledStartAt: 'asc' },
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
      orderBy: { scheduledStartAt: 'asc' },
      include: { contract: true },
    }),

  updateStatus: (id: string, status: SessionStatus, extra?: Record<string, any>) =>
    prisma.session.update({
      where: { id },
      data: { status, ...extra },
    }),

  /** Count non-terminal sessions for a contract (to enforce session limit) */
  countActiveByContract: (contractId: string) =>
    prisma.session.count({
      where: {
        contractId,
        status: { in: [SessionStatus.REQUESTED, SessionStatus.CONFIRMED] },
      },
    }),

  /** Check for overlapping sessions for a PT at a given time range */
  findConflict: (ptUserId: string, startAt: Date, endAt: Date, excludeId?: string) =>
    prisma.session.findFirst({
      where: {
        ptUserId,
        status: { in: [SessionStatus.REQUESTED, SessionStatus.CONFIRMED] },
        ...(excludeId && { id: { not: excludeId } }),
        // Overlap: existing.start < new.end AND existing.end > new.start
        scheduledStartAt: { lt: endAt },
        scheduledEndAt: { gt: startAt },
      },
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
  }) =>
    prisma.sessionReview.create({ data }),
};
