/**
 * B9a — URL-state parsing for the PT / branch / partner admin pages (Master Plan §2.3).
 * Pure functions (no React) so they run under `tsx --test`. Every parser is total: an unknown
 * or hostile value falls back to the default instead of throwing, so a stale/typo'd link opens
 * the list, never a blank page.
 */

/** Short, copyable form of an internal id (admins quote it, never read it). */
export function shortRef(id: string | null | undefined): string {
  if (!id) return "—";
  return id.length <= 8 ? id : id.slice(0, 8);
}

/** An id param is a plain token (uuid / cuid). Anything else is treated as absent. */
export function parseIdParam(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v || v.length > 64) return null;
  return /^[A-Za-z0-9_-]+$/.test(v) ? v : null;
}

// ── Hồ sơ PT ────────────────────────────────────────────────────────────────
export const PT_FILTERS = ["all", "SUBMITTED", "UNDER_REVIEW", "NEEDS_MORE_INFO", "APPROVED", "REJECTED"] as const;
export type PtFilter = (typeof PT_FILTERS)[number];
export function parsePtFilter(raw: string | null | undefined): PtFilter {
  return (PT_FILTERS as readonly string[]).includes(raw ?? "") ? (raw as PtFilter) : "all";
}

// ── Chi nhánh (kiểm duyệt) ──────────────────────────────────────────────────
export const GYM_TABS = ["pending", "gym-renames", "brand-renames", "closed", "all-gyms"] as const;
export type GymTab = (typeof GYM_TABS)[number];
export const DEFAULT_GYM_TAB: GymTab = "pending";
export function parseGymTab(raw: string | null | undefined): GymTab {
  return (GYM_TABS as readonly string[]).includes(raw ?? "") ? (raw as GymTab) : DEFAULT_GYM_TAB;
}

// ── Đối tác phòng gym ───────────────────────────────────────────────────────
export const PARTNER_VIEWS = ["applications", "partners"] as const;
export type PartnerView = (typeof PARTNER_VIEWS)[number];
export const DEFAULT_PARTNER_VIEW: PartnerView = "applications";
export function parsePartnerView(raw: string | null | undefined): PartnerView {
  return (PARTNER_VIEWS as readonly string[]).includes(raw ?? "") ? (raw as PartnerView) : DEFAULT_PARTNER_VIEW;
}

export const PARTNER_DETAIL_TABS = ["overview", "accounts", "gyms", "documents", "money", "audit", "notes", "complaints"] as const;
export type PartnerDetailTab = (typeof PARTNER_DETAIL_TABS)[number];
export function parsePartnerDetailTab(raw: string | null | undefined): PartnerDetailTab {
  return (PARTNER_DETAIL_TABS as readonly string[]).includes(raw ?? "") ? (raw as PartnerDetailTab) : "overview";
}

export const PARTNER_STATUS_FILTERS = ["ALL", "PROSPECT", "INVITED", "ACTIVE", "SUSPENDED", "TERMINATED"] as const;
export type PartnerStatusFilter = (typeof PARTNER_STATUS_FILTERS)[number];
export function parsePartnerStatus(raw: string | null | undefined): PartnerStatusFilter {
  return (PARTNER_STATUS_FILTERS as readonly string[]).includes(raw ?? "") ? (raw as PartnerStatusFilter) : "ALL";
}

/**
 * Builds the query string for the partners page. Defaults are omitted so the plain URL stays
 * `/admin/partners`; `tab` is only meaningful with a partner `id`.
 */
export function buildPartnerParams(s: { view?: PartnerView; id?: string | null; tab?: PartnerDetailTab; status?: PartnerStatusFilter }): Record<string, string> {
  const out: Record<string, string> = {};
  const view = s.view ?? DEFAULT_PARTNER_VIEW;
  if (view !== DEFAULT_PARTNER_VIEW) out.view = view;
  if (s.id) out.id = s.id;
  if (s.id && view === "partners" && s.tab && s.tab !== "overview") out.tab = s.tab;
  if (!s.id && view === "partners" && s.status && s.status !== "ALL") out.status = s.status;
  return out;
}
