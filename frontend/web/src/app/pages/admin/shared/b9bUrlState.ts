/**
 * B9b — URL-state parsing for the Người dùng / Giám sát AI admin pages (Master Plan §2.3).
 * Pure functions (no React) so they run under `tsx --test`. Every parser is total: an unknown or
 * hostile value falls back to the default, so a stale/typo'd link opens the list, never a blank page.
 * Id handling reuses `parseIdParam` from b9aUrlState.
 */

/** Positive integer page number; anything else is page 1. */
export function parsePageParam(raw: string | null | undefined): number {
  const n = Number((raw ?? "").trim());
  return Number.isInteger(n) && n >= 1 && n <= 100000 ? n : 1;
}

/** Client-side paging (the user list API is unpaginated). `page` is clamped into range. */
export function paginate<T>(items: T[], page: number, size: number): { rows: T[]; page: number; pages: number; total: number } {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(1, page), pages);
  return { rows: items.slice((p - 1) * size, p * size), page: p, pages, total };
}

// ── Người dùng ──────────────────────────────────────────────────────────────
export const USER_ROLE_FILTERS = ["All", "Client", "PT", "OWNER", "MANAGER", "RECEPTIONIST", "ACCOUNTANT", "Admin"] as const;
export type UserRoleFilter = (typeof USER_ROLE_FILTERS)[number];
export function parseUserRole(raw: string | null | undefined): UserRoleFilter {
  return (USER_ROLE_FILTERS as readonly string[]).includes(raw ?? "") ? (raw as UserRoleFilter) : "All";
}
export const USER_STATUS_FILTERS = ["All", "Active", "Inactive", "Pending"] as const;
export type UserStatusFilter = (typeof USER_STATUS_FILTERS)[number];
export function parseUserStatus(raw: string | null | undefined): UserStatusFilter {
  return (USER_STATUS_FILTERS as readonly string[]).includes(raw ?? "") ? (raw as UserStatusFilter) : "All";
}
export function parseSearchParam(raw: string | null | undefined): string {
  return (raw ?? "").slice(0, 80);
}

/** Defaults are omitted so the plain URL stays `/admin/users`. */
export function buildUserParams(s: { id?: string | null; role?: UserRoleFilter; status?: UserStatusFilter; q?: string; page?: number }): Record<string, string> {
  const out: Record<string, string> = {};
  if (s.id) out.id = s.id;
  if (s.role && s.role !== "All") out.role = s.role;
  if (s.status && s.status !== "All") out.status = s.status;
  if (s.q && s.q.trim()) out.q = s.q;
  if (s.page && s.page > 1) out.page = String(s.page);
  return out;
}

// ── Giám sát AI ─────────────────────────────────────────────────────────────
export const AI_TABS = ["requests", "queue", "errors", "knowledge"] as const;
export type AiTab = (typeof AI_TABS)[number];
export function parseAiTab(raw: string | null | undefined): AiTab {
  return (AI_TABS as readonly string[]).includes(raw ?? "") ? (raw as AiTab) : "requests";
}
export const AI_FILTERS = ["all", "fallback", "slow", "warnings"] as const;
export type AiFilter = (typeof AI_FILTERS)[number];
export function parseAiFilter(raw: string | null | undefined): AiFilter {
  return (AI_FILTERS as readonly string[]).includes(raw ?? "") ? (raw as AiFilter) : "all";
}
/** `filter`/`page` only belong to the Yêu cầu tab; `id` (trace detail) opens from the Yêu cầu or Lỗi tab. */
export function buildAiParams(s: { tab?: AiTab; filter?: AiFilter; page?: number; id?: string | null }): Record<string, string> {
  const out: Record<string, string> = {};
  const tab = s.tab ?? "requests";
  if (tab !== "requests") out.tab = tab;
  if (tab === "requests" && s.filter && s.filter !== "all") out.filter = s.filter;
  if (tab === "requests" && s.page && s.page > 1) out.page = String(s.page);
  if (s.id) out.id = s.id;
  return out;
}
