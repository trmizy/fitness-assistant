import { gymService } from './gym.service';
import { checkinRepository } from '../repositories/checkin.repository';
import { membershipRepository } from '../repositories/membership.repository';
import { APP_TIME_ZONE, localDateOf, windowOfLocalDate } from '../utils/local-day';

/**
 * KPI endpoint of the owner dashboard: GET /owner/gyms/:gymId/stats?from=YYYY-MM-DD&to=YYYY-MM-DD.
 *
 * Everything is counted by the database (no row list is loaded), and the check-in days are VIETNAM calendar days
 * (Asia/Ho_Chi_Minh, fixed +07:00) - the same day boundary front-desk and PT check-in use - never the server or browser
 * clock zone. `from`/`to` are local dates and BOTH are inclusive.
 */

export const STATS_DEFAULT_DAYS = 7;
/** Longest range one call may ask for (inclusive days). Keeps the GROUP BY and the zero-filled series bounded. */
export const STATS_MAX_DAYS = 92;
/** A running membership counts as "expiring soon" when it ends within this many days from now. */
export const EXPIRING_SOON_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function badRequest(message: string, code: string) {
  return Object.assign(new Error(message), { status: 400, code });
}

/** Parses 'YYYY-MM-DD' and rejects impossible dates (2026-02-31) by round-tripping through the VN calendar. */
function parseLocalDate(raw: string, name: string): string {
  if (!DATE_RE.test(raw)) throw badRequest(`${name} phải có dạng YYYY-MM-DD`, 'INVALID_QUERY');
  let start: Date;
  try {
    start = windowOfLocalDate(raw).start;
  } catch {
    throw badRequest(`${name} không phải ngày hợp lệ`, 'INVALID_QUERY');
  }
  if (localDateOf(start) !== raw) throw badRequest(`${name} không phải ngày hợp lệ`, 'INVALID_QUERY');
  return raw;
}

export function shiftLocalDate(localDate: string, days: number): string {
  return localDateOf(new Date(windowOfLocalDate(localDate).start.getTime() + days * DAY_MS));
}

function daysBetweenInclusive(from: string, to: string): number {
  return Math.round((windowOfLocalDate(to).start.getTime() - windowOfLocalDate(from).start.getTime()) / DAY_MS) + 1;
}

/** Defaults: neither bound = the last 7 local days ending today; only `to` = the 7 days ending there; only `from` = from..today. */
export function resolveStatsRange(
  query: { from?: unknown; to?: unknown },
  now: Date = new Date(),
): { from: string; to: string; days: number } {
  const str = (v: unknown, name: string): string | undefined => {
    if (v === undefined || v === '') return undefined;
    if (typeof v !== 'string') throw badRequest(`${name} phải là một chuỗi ngày YYYY-MM-DD`, 'INVALID_QUERY');
    return v;
  };
  const rawFrom = str(query.from, 'from');
  const rawTo = str(query.to, 'to');
  const today = localDateOf(now);
  const to = rawTo ? parseLocalDate(rawTo, 'to') : today;
  const from = rawFrom ? parseLocalDate(rawFrom, 'from') : shiftLocalDate(to, -(STATS_DEFAULT_DAYS - 1));
  const days = daysBetweenInclusive(from, to);
  if (days < 1) throw badRequest('from phải nhỏ hơn hoặc bằng to', 'INVALID_RANGE');
  if (days > STATS_MAX_DAYS) {
    throw badRequest(`Khoảng thời gian tối đa ${STATS_MAX_DAYS} ngày (đang yêu cầu ${days} ngày)`, 'RANGE_TOO_LARGE');
  }
  return { from, to, days };
}

export interface GymStats {
  gymId: string;
  timeZone: string;
  from: string;
  to: string;
  today: string;
  /** null when the caller's role may not read check-ins (checkin.list). */
  checkins: { today: number; total: number; daily: { date: string; count: number }[] } | null;
  /** null when the caller's role may not read memberships (membership.full / membership.sales). */
  memberships: {
    active: number;
    expiringSoon: number;
    expiringSoonDays: number;
    byStatus: Record<string, number>;
  } | null;
}

export const gymStatsService = {
  /**
   * `ownerId` is the PARTNER principal (principalId(req)); getOwnedGym proves the branch belongs to that partner
   * (404 unknown / 403 someone else's) - the route's requirePermission(gymParam) has already checked the staff scope.
   * `visibility` is decided by the controller from the caller's permissions, so a role never receives numbers it could not
   * read through the neighbouring endpoints.
   */
  async getStats(
    gymId: string,
    ownerId: string,
    query: { from?: unknown; to?: unknown },
    visibility: { checkins: boolean; memberships: boolean },
    now: Date = new Date(),
  ): Promise<GymStats> {
    await gymService.getOwnedGym(gymId, ownerId);
    const range = resolveStatsRange(query, now);
    const today = localDateOf(now);

    const rangeStart = windowOfLocalDate(range.from).start;
    const rangeEnd = windowOfLocalDate(range.to).end;
    // "Today" is always answered, even when the requested range does not include it.
    const todayWindow = windowOfLocalDate(today);

    let checkins: GymStats['checkins'] = null;
    if (visibility.checkins) {
      const todayInRange = range.from <= today && today <= range.to;
      const [perDay, todayPerDay] = await Promise.all([
        checkinRepository.countPerLocalDay(gymId, rangeStart, rangeEnd),
        todayInRange ? Promise.resolve(null) : checkinRepository.countPerLocalDay(gymId, todayWindow.start, todayWindow.end),
      ]);
      const daily: { date: string; count: number }[] = [];
      let total = 0;
      for (let i = 0; i < range.days; i++) {
        const date = shiftLocalDate(range.from, i);
        const count = perDay.get(date) ?? 0;
        total += count;
        daily.push({ date, count });
      }
      checkins = { today: (todayPerDay ?? perDay).get(today) ?? 0, total, daily };
    }

    let memberships: GymStats['memberships'] = null;
    if (visibility.memberships) {
      const stats = await membershipRepository.statsForGym(gymId, now, new Date(now.getTime() + EXPIRING_SOON_DAYS * DAY_MS));
      memberships = { ...stats, expiringSoonDays: EXPIRING_SOON_DAYS };
    }

    return { gymId, timeZone: APP_TIME_ZONE, from: range.from, to: range.to, today, checkins, memberships };
  },
};
