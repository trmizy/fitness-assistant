/**
 * GET /owner/gyms/:gymId/stats (G5): KPI counts the DATABASE did, by Vietnam calendar day. One shared query key per user + branch, so
 * Hôm nay (branch rows) and Hội viên (status counts) read one cache entry and the assisted check-in can invalidate exactly it.
 *
 * Honesty rules (05 section 6/8):
 *  - A block the role may not read arrives as `null`; it is never turned into 0. A failed request is `error`, never 0.
 *  - Every number belongs to ONE branch. Nothing here adds branches together; a total over branches would need EVERY branch
 *    loaded, and the pages that show per-branch numbers do not show a brand total at all.
 *  - "Đang chạy" (`active`) is a membership that is running right now (ACTIVE, not past its end date, already started); it is NOT
 *    the raw ACTIVE status count (`byStatus.ACTIVE`), which still includes a queued renewal. Both are drawn under their own words.
 */
import type { QueryClient } from "@tanstack/react-query";
import type { GymStats } from "../../../types";

export const GYM_STATS_KEY = "gym-owner-stats";

export const gymStatsKey = (userId: string, gymId: string) => [GYM_STATS_KEY, userId, gymId] as const;
/** The same endpoint with an explicit from/to (charts). Starts with `gymStatsKey`, so `invalidateGymStats` refreshes it too. */
export const gymStatsRangeKey = (userId: string, gymId: string, from: string, to: string) => [GYM_STATS_KEY, userId, gymId, "range", from, to] as const;

/** Refresh the stats of one branch (after an assisted check-in) or every branch of this user. */
export function invalidateGymStats(queryClient: Pick<QueryClient, "invalidateQueries">, userId: string, gymId?: string): Promise<unknown> {
  return queryClient.invalidateQueries({ queryKey: gymId ? gymStatsKey(userId, gymId) : [GYM_STATS_KEY, userId] });
}

export type StatsState = { state: "loading" } | { state: "error" } | { state: "ok"; stats: GymStats };

/** A summary line of one branch: every field is `null` when unknown (loading, failed, or the role has no such block). */
export interface BranchStatsLine {
  state: StatsState["state"];
  checkinsToday: number | null;
  runningMemberships: number | null;
  expiringSoon: number | null;
  expiringSoonDays: number | null;
}

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

export function statsLineOf(s: StatsState): BranchStatsLine {
  const none: BranchStatsLine = { state: s.state, checkinsToday: null, runningMemberships: null, expiringSoon: null, expiringSoonDays: null };
  if (s.state !== "ok") return none;
  const c = s.stats.checkins;
  const m = s.stats.memberships;
  return {
    state: "ok",
    checkinsToday: c && isCount(c.today) ? c.today : null,
    runningMemberships: m && isCount(m.active) ? m.active : null,
    expiringSoon: m && isCount(m.expiringSoon) ? m.expiringSoon : null,
    expiringSoonDays: m && isCount(m.expiringSoonDays) ? m.expiringSoonDays : null,
  };
}

/** Raw status counts for the Hội viên filter, or null when the server did not send the memberships block. */
export function byStatusOf(s: StatsState): Record<string, number> | null {
  if (s.state !== "ok" || !s.stats.memberships || typeof s.stats.memberships.byStatus !== "object" || s.stats.memberships.byStatus === null) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(s.stats.memberships.byStatus)) if (isCount(v)) out[k] = v;
  return out;
}

/** "Check-in hôm nay: 12" / "Chưa tải được số liệu hôm nay" - the words of the per-branch stats lines of Hôm nay. */
export function statsLineText(l: BranchStatsLine): string[] {
  if (l.state === "loading") return ["Đang tải số liệu hôm nay"];
  if (l.state === "error") return ["Chưa tải được số liệu hôm nay"];
  const out: string[] = [];
  if (l.checkinsToday !== null) out.push(`${l.checkinsToday} lượt check-in hôm nay`);
  if (l.expiringSoon !== null) out.push(`${l.expiringSoon} thẻ sắp hết hạn${l.expiringSoonDays ? ` trong ${l.expiringSoonDays} ngày` : ""}`);
  return out;
}
