import { Prisma } from '../generated/prisma';
import { prisma } from './prisma';
import { APP_TIME_ZONE } from '../utils/local-day';

/**
 * Owner analytics (GET /owner/gyms/:gymId/analytics): every number is a GROUP BY / aggregate in the database, nothing is loaded
 * row by row. Same time convention as checkinRepository.countPerLocalDay: the timestamp columns are `timestamp(3)` WITHOUT zone
 * holding UTC wall-clock, so a Vietnam day/hour is `(col AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh'`, and the range bounds
 * are sent as ISO text cast to `timestamp` (the zone suffix is ignored by that cast) so nothing depends on the DB session TimeZone.
 *
 * "Paid membership" = status ACTIVE or EXPIRED, the exact rule of the Finance page's "doanh số" (financeExport.recognizedSales);
 * rows are REAL only (the rule stats.membershipRepository.statsForGym applies). PENDING_PAYMENT / PENDING_ISSUE / CANCELLED never count.
 */

/** The statuses of a paid, delivered membership (Finance "doanh số"). */
export const PAID_MEMBERSHIP_STATUSES = ['ACTIVE', 'EXPIRED'] as const;

const LOCAL = (col: string) => Prisma.raw(`((${col} AT TIME ZONE 'UTC') AT TIME ZONE '${APP_TIME_ZONE}')`);
const ts = (d: Date) => Prisma.sql`${d.toISOString()}::timestamp`;

export interface SalesDayRow { date: string; count: number; gross: number }
export interface SalesPlanRow { planId: string; name: string; count: number; gross: number }
export interface HeatCell { weekday: number; hour: number; count: number }
export interface RenewalCounts {
  ended: number;
  renewed: number;
  renewedSameBranch: number;
  matured: number;
  maturedRenewed: number;
}
export interface NewReturningRow { date: string; newCount: number; returningCount: number }

export const analyticsRepository = {
  /** Gym ids that share this branch's brand (always includes the branch itself; a standalone branch is just itself). */
  async brandGymIds(gymId: string): Promise<string[]> {
    const gym = await prisma.gym.findUnique({ where: { id: gymId }, select: { brandId: true } });
    if (!gym?.brandId) return [gymId];
    const rows = await prisma.gym.findMany({ where: { brandId: gym.brandId }, select: { id: true } });
    const ids = rows.map((r) => r.id);
    return ids.includes(gymId) ? ids : [gymId, ...ids];
  },

  /**
   * Check-ins per ISO weekday (1 = Monday .. 7 = Sunday) x hour of day (0..23), Vietnam time, inside [start, end).
   * Counts the same rows as stats' check-in total (gym_check_ins has no data_origin column), so the two always agree.
   * Index: gym_check_ins(gym_id, created_at).
   */
  async checkinHeat(gymId: string, start: Date, end: Date): Promise<HeatCell[]> {
    const rows = await prisma.$queryRaw<{ weekday: number; hour: number; count: number }[]>(Prisma.sql`
      SELECT EXTRACT(ISODOW FROM ${LOCAL('created_at')})::int AS weekday,
             EXTRACT(HOUR FROM ${LOCAL('created_at')})::int AS hour,
             COUNT(*)::int AS count
        FROM gym_check_ins
       WHERE gym_id = ${gymId} AND created_at >= ${ts(start)} AND created_at < ${ts(end)}
       GROUP BY 1, 2`);
    return rows.map((r) => ({ weekday: Number(r.weekday), hour: Number(r.hour), count: Number(r.count) }));
  },

  /** Paid memberships sold in [start, end) (by `created_at`, the purchase time), per Vietnam day. gross = SUM(price_at_purchase). */
  async salesPerDay(gymId: string, start: Date, end: Date): Promise<SalesDayRow[]> {
    const rows = await prisma.$queryRaw<{ date: string; count: number; gross: number }[]>(Prisma.sql`
      SELECT to_char(${LOCAL('created_at')}, 'YYYY-MM-DD') AS date,
             COUNT(*)::int AS count,
             COALESCE(SUM(price_at_purchase), 0)::float8 AS gross
        FROM gym_membership_contracts
       WHERE gym_id = ${gymId} AND data_origin = 'REAL' AND status IN ('ACTIVE', 'EXPIRED')
         AND created_at >= ${ts(start)} AND created_at < ${ts(end)}
       GROUP BY 1`);
    return rows.map((r) => ({ date: r.date, count: Number(r.count), gross: Number(r.gross) }));
  },

  /** The same sales, per plan (name read once per plan from the plan row). Highest gross first. */
  async salesPerPlan(gymId: string, start: Date, end: Date): Promise<SalesPlanRow[]> {
    const rows = await prisma.$queryRaw<{ plan_id: string; name: string; count: number; gross: number }[]>(Prisma.sql`
      SELECT m.plan_id AS plan_id, p.name AS name, COUNT(*)::int AS count,
             COALESCE(SUM(m.price_at_purchase), 0)::float8 AS gross
        FROM gym_membership_contracts m
        JOIN gym_membership_plans p ON p.id = m.plan_id
       WHERE m.gym_id = ${gymId} AND m.data_origin = 'REAL' AND m.status IN ('ACTIVE', 'EXPIRED')
         AND m.created_at >= ${ts(start)} AND m.created_at < ${ts(end)}
       GROUP BY m.plan_id, p.name
       ORDER BY gross DESC, p.name ASC`);
    return rows.map((r) => ({ planId: r.plan_id, name: r.name, count: Number(r.count), gross: Number(r.gross) }));
  },

  /**
   * Renewal funnel of the memberships of THIS branch whose `end_date` fell inside [start, end) and is already past (`<= now`);
   * a still-running membership has no outcome yet.
   *   renewed            = the same client holds another paid REAL membership of the same BRAND whose `start_date` is in
   *                        [end_date, end_date + windowDays]. Membership stacking starts a renewal bought while the old card still runs
   *                        exactly at its end_date, and a lapsed client's new card starts at purchase, so one rule covers "bought early",
   *                        "bought on the day" and "came back within N days".
   *   renewedSameBranch  = the same, but the new card is at this very branch.
   *   matured            = ended cards whose whole window is over (end_date + windowDays <= now): the only cohort whose "not renewed" is final.
   * Index: gym_membership_contracts(gym_id, status) for the ended set, (client_id, status) for each lookup. No identity leaves the query.
   */
  async renewalCounts(gymId: string, brandGymIds: readonly string[], start: Date, end: Date, now: Date, windowDays: number): Promise<RenewalCounts> {
    const rows = await prisma.$queryRaw<RenewalCounts[]>(Prisma.sql`
      WITH ended AS (
        SELECT m.id, m.end_date,
               COALESCE(r.renewed, false) AS renewed,
               COALESCE(r.renewed_branch, false) AS renewed_branch,
               (m.end_date + (${windowDays}::int * INTERVAL '1 day') <= ${ts(now)}) AS is_matured
          FROM gym_membership_contracts m
          LEFT JOIN LATERAL (
            SELECT true AS renewed, COALESCE(bool_or(n.gym_id = m.gym_id), false) AS renewed_branch
              FROM gym_membership_contracts n
             WHERE n.client_id = m.client_id AND n.id <> m.id
               AND n.gym_id IN (${Prisma.join(brandGymIds)})
               AND n.data_origin = 'REAL' AND n.status IN ('ACTIVE', 'EXPIRED')
               AND n.start_date >= m.end_date
               AND n.start_date <= m.end_date + (${windowDays}::int * INTERVAL '1 day')
            HAVING COUNT(*) > 0
          ) r ON true
         WHERE m.gym_id = ${gymId} AND m.data_origin = 'REAL' AND m.status IN ('ACTIVE', 'EXPIRED')
           AND m.end_date >= ${ts(start)} AND m.end_date < ${ts(end)} AND m.end_date <= ${ts(now)}
      )
      SELECT COUNT(*)::int AS "ended",
             (COUNT(*) FILTER (WHERE renewed))::int AS "renewed",
             (COUNT(*) FILTER (WHERE renewed_branch))::int AS "renewedSameBranch",
             (COUNT(*) FILTER (WHERE is_matured))::int AS "matured",
             (COUNT(*) FILTER (WHERE is_matured AND renewed))::int AS "maturedRenewed"
        FROM ended`);
    const r = rows[0];
    return {
      ended: Number(r?.ended ?? 0),
      renewed: Number(r?.renewed ?? 0),
      renewedSameBranch: Number(r?.renewedSameBranch ?? 0),
      matured: Number(r?.matured ?? 0),
      maturedRenewed: Number(r?.maturedRenewed ?? 0),
    };
  },

  /**
   * Paid memberships sold in [start, end) split per Vietnam day into NEW (the client held no earlier paid REAL membership
   * of this brand) and RETURNING (they did). "Earlier" = bought earlier, ties broken by id, so exactly one of two same-instant cards is new.
   */
  async newVsReturningPerDay(gymId: string, brandGymIds: readonly string[], start: Date, end: Date): Promise<NewReturningRow[]> {
    const rows = await prisma.$queryRaw<{ date: string; new_count: number; returning_count: number }[]>(Prisma.sql`
      SELECT to_char(${LOCAL('x.created_at')}, 'YYYY-MM-DD') AS date,
             (COUNT(*) FILTER (WHERE NOT x.had_prior))::int AS new_count,
             (COUNT(*) FILTER (WHERE x.had_prior))::int AS returning_count
        FROM (
          SELECT m.created_at,
                 EXISTS (
                   SELECT 1 FROM gym_membership_contracts p
                    WHERE p.client_id = m.client_id AND p.id <> m.id
                      AND p.gym_id IN (${Prisma.join(brandGymIds)})
                      AND p.data_origin = 'REAL' AND p.status IN ('ACTIVE', 'EXPIRED')
                      AND (p.created_at < m.created_at OR (p.created_at = m.created_at AND p.id < m.id))
                 ) AS had_prior
            FROM gym_membership_contracts m
           WHERE m.gym_id = ${gymId} AND m.data_origin = 'REAL' AND m.status IN ('ACTIVE', 'EXPIRED')
             AND m.created_at >= ${ts(start)} AND m.created_at < ${ts(end)}
        ) x
       GROUP BY 1`);
    return rows.map((r) => ({ date: r.date, newCount: Number(r.new_count), returningCount: Number(r.returning_count) }));
  },
};
