import { DayOfWeek } from '../generated/prisma';
import { prisma } from './profile.repository';

export const availabilityRepository = {
  // Get all availability slots for a PT
  findByPT: (ptUserId: string) =>
    prisma.pTAvailability.findMany({
      where: { ptUserId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    }),

  // Replace all slots for a PT (delete + create in transaction)
  replaceAll: (ptUserId: string, slots: { dayOfWeek: DayOfWeek; startTime: string; endTime: string }[]) =>
    prisma.$transaction([
      prisma.pTAvailability.deleteMany({ where: { ptUserId } }),
      ...slots.map((s) =>
        prisma.pTAvailability.create({
          data: { ptUserId, dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime },
        }),
      ),
    ]),

  // Get exceptions for a PT within a date range
  findExceptions: (ptUserId: string, from?: Date, to?: Date) =>
    prisma.pTScheduleException.findMany({
      where: {
        ptUserId,
        ...(from && to ? { date: { gte: from, lte: to } } : {}),
      },
      orderBy: { date: 'asc' },
    }),

  // Add a schedule exception (blocked date)
  addException: (ptUserId: string, date: Date, reason?: string) =>
    prisma.pTScheduleException.create({
      data: { ptUserId, date, reason },
    }),

  // Remove a schedule exception
  removeException: (id: string, ptUserId: string) =>
    prisma.pTScheduleException.deleteMany({
      where: { id, ptUserId },
    }),
};
