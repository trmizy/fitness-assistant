import { Prisma } from '../generated/prisma';
import { prisma } from './prisma';
import { APP_TIME_ZONE } from '../utils/local-day';

export const checkinRepository = {
  async listForGym(gymId: string, limit = 50) {
    return prisma.gymCheckIn.findMany({
      where: { gymId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },

  /**
   * Check-ins of one branch per LOCAL calendar day (Asia/Ho_Chi_Minh) inside [start, end), counted in SQL - no row is
   * ever loaded, so the number is exact however many visits a branch has (the list endpoint is capped at 50 rows).
   *
   * `created_at` is a `timestamp(3)` WITHOUT time zone holding UTC wall-clock (that is how Prisma writes a Date), so the
   * day is `(created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh'` - the first cast declares the stored value
   * UTC, the second moves it to the VN wall clock. The bounds are sent as ISO text cast to `timestamp` (the zone suffix
   * is ignored by that cast), so the comparison never depends on the DB session's TimeZone setting.
   */
  async countPerLocalDay(gymId: string, start: Date, end: Date): Promise<Map<string, number>> {
    const rows = await prisma.$queryRaw<{ day: string; count: number }[]>(Prisma.sql`
      SELECT to_char((created_at AT TIME ZONE 'UTC') AT TIME ZONE ${APP_TIME_ZONE}, 'YYYY-MM-DD') AS day,
             COUNT(*)::int AS count
      FROM gym_check_ins
      WHERE gym_id = ${gymId}
        AND created_at >= ${start.toISOString()}::timestamp
        AND created_at < ${end.toISOString()}::timestamp
      GROUP BY 1`);
    return new Map(rows.map((r) => [r.day, Number(r.count)]));
  },
};
