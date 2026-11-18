/**
 * POST /auth/users/dashboard-summary - body validation (pure, so it can be unit-tested without a database).
 *
 * The admin dashboard on AWS used to read EVERY account through GET /auth/users and count them in memory. A Lambda answers a synchronous invoke
 * with at most ~6 MB, and an account row is ~216 bytes, so 37k accounts no longer fit (and the answer is built, shipped and mapped for nothing: the
 * dashboard shows a handful of numbers and four rows). The numbers are computed here, in the database, in one pass.
 */

export const DASHBOARD_SUMMARY_MAX_IDS = 200_000;
export const DASHBOARD_SUMMARY_MAX_RECENT = 20;

export type DashboardSummaryQuery = {
  /** Accounts left out of every number (test / seed / synthetic), already decided by the caller. */
  excludeIds: string[];
  /** Also leave out every account on a reserved test email domain (the rule auth-service owns), without the caller listing their ids. */
  excludeTestDomains: boolean;
  /** Profiles flagged as trainers in user-service (isPT). */
  ptUserIds: string[];
  /** Start of the oldest month bucket (ISO). Accounts created before it are only counted in the totals. */
  since: Date;
  recentLimit: number;
};

export type DashboardSummaryQueryError = { status: 400; code: string; message: string };

const isStringList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= DASHBOARD_SUMMARY_MAX_IDS && v.every((x) => typeof x === "string" && x.length > 0 && x.length <= 64);

export function parseDashboardSummaryBody(body: unknown): DashboardSummaryQuery | DashboardSummaryQueryError {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const bad = (code: string, message: string): DashboardSummaryQueryError => ({ status: 400, code, message });

  const excludeIds = b.excludeIds === undefined ? [] : b.excludeIds;
  if (!isStringList(excludeIds)) return bad("INVALID_EXCLUDE_IDS", "excludeIds phải là danh sách mã (tối đa 200000)");
  const ptUserIds = b.ptUserIds === undefined ? [] : b.ptUserIds;
  if (!isStringList(ptUserIds)) return bad("INVALID_PT_IDS", "ptUserIds phải là danh sách mã (tối đa 200000)");
  if (b.excludeTestDomains !== undefined && typeof b.excludeTestDomains !== "boolean") {
    return bad("INVALID_EXCLUDE_TEST_DOMAINS", "excludeTestDomains phải là true hoặc false");
  }

  const since = typeof b.since === "string" ? new Date(b.since) : null;
  if (!since || Number.isNaN(since.getTime())) return bad("INVALID_SINCE", "since phải là thời điểm ISO hợp lệ");

  const recentRaw = b.recentLimit === undefined ? 4 : b.recentLimit;
  if (typeof recentRaw !== "number" || !Number.isInteger(recentRaw) || recentRaw < 1 || recentRaw > DASHBOARD_SUMMARY_MAX_RECENT) {
    return bad("INVALID_RECENT_LIMIT", `recentLimit là số nguyên từ 1 đến ${DASHBOARD_SUMMARY_MAX_RECENT}`);
  }
  return { excludeIds, excludeTestDomains: b.excludeTestDomains === true, ptUserIds, since, recentLimit: recentRaw };
}

export const isDashboardSummaryQueryError = (v: DashboardSummaryQuery | DashboardSummaryQueryError): v is DashboardSummaryQueryError => "code" in v;

export type DashboardSummary = {
  totalUsers: number;
  roleCounts: { CUSTOMER: number; PT: number; GYM_OWNER: number };
  /** role PT, or a profile flagged isPT */
  trainers: number;
  /** flagged isPT but the auth role is not PT yet */
  pendingPT: number;
  /** key "YYYY-MM" (Asia/Ho_Chi_Minh month of createdAt) -> accounts created that month, only months >= since */
  monthCounts: Record<string, number>;
  recent: Array<{ id: string; email: string; firstName: string | null; lastName: string | null; role: string; isActive: boolean; createdAt: string }>;
};
