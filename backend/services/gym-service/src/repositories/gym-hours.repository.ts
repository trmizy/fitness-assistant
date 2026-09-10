import { prisma } from './prisma';
import type { WeekDay, DayScheduleType } from '../generated/prisma';

export const gymHoursRepository = {
  findByGym(gymId: string) {
    return prisma.gymOperatingHours.findMany({ where: { gymId } });
  },

  /**
   * Replace all 7 days in one transaction — the editor UI always saves the whole week
   * together (there is no per-day save action in the spec's design), so there is no
   * meaningful "partial upsert" case to support. `deleteMany` + `createMany` inside one
   * transaction is simpler than 7 individual upserts and just as atomic.
   */
  async replaceAll(gymId: string, rows: { day: WeekDay; type: DayScheduleType; openMinute: number | null; closeMinute: number | null }[]) {
    return prisma.$transaction([
      prisma.gymOperatingHours.deleteMany({ where: { gymId } }),
      prisma.gymOperatingHours.createMany({ data: rows.map((r) => ({ gymId, ...r })) }),
    ]);
  },
};
