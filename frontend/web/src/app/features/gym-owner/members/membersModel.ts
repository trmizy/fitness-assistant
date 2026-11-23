/**
 * Hội viên & gói (batch G3) - pure model, no React. Everything the page decides without a server answer lives here so it can be
 * unit tested: tab <-> URL, what each role may see/do, the two shapes of the membership list (FULL for owner/manager, SALES for
 * the accountant), search / status / plan filter, sort, counts, the member drawer's check-in slice, the plan form rules.
 *
 * Honesty rules the page keeps (docs/gym-owner-redesign/audit/02, 05 section 4, 06 section 3):
 *  - G5: `GET /owner/gyms/:gymId/memberships` is paged by the SERVER (cursor, newest first) and filters by `status` only. The page
 *    offers exactly that: a status filter that goes to the server, "Xem thêm" for the next page. No name search, plan filter or
 *    sort is offered, because the API cannot do them (running them on one page would read as an answer about the whole branch).
 *    Status counts are drawn only when `GET /owner/gyms/:id/stats` returns them (`byStatus`); they are never derived from a page.
 *  - SALES view (accountant) never carries a client id or name; this module drops them even if a server ever sent them.
 *  - A client's internal id is never shown (a row without a name reads "Hội viên chưa có tên").
 *  - The member's check-ins come from the branch's latest 50 check-ins (`GET .../checkins`), filtered here; that limit is stated.
 */
import type { CanFn } from "../../../utils/gymStaffRole";
import type { TagTone } from "../scope/scopeModel";

// ---------------------------------------------------------------------------------------------------------------------
// Tabs and URL
// ---------------------------------------------------------------------------------------------------------------------

export const MEMBERS_TAB_IDS = ["members", "plans"] as const;
export type MembersTabId = (typeof MEMBERS_TAB_IDS)[number];

export function parseMembersTab(raw: string | null | undefined): MembersTabId {
  return raw === "plans" ? "plans" : "members";
}

/** `?gymId=<id>&tab=members|plans` (gymId is kept across the two tabs so coming back to Hội viên is the same branch). */
export function membersSearch(tab: MembersTabId, gymId: string | null | undefined): string {
  const sp = new URLSearchParams();
  if (gymId) sp.set("gymId", gymId);
  sp.set("tab", tab);
  return `?${sp.toString()}`;
}

export function membersHref(tab: MembersTabId, gymId?: string | null): string {
  return `/gym-owner/members${membersSearch(tab, gymId)}`;
}

/** `/gym-owner/plans` (flag on) lands on the Gói tab of the new page. */
export const PLANS_REDIRECT = "/gym-owner/members?tab=plans";

// ---------------------------------------------------------------------------------------------------------------------
// Roles (audit/02: membership.full O,M; membership.sales O,A; plan.view O,M,A; plan.write owner only)
// ---------------------------------------------------------------------------------------------------------------------

export type MembersMode = "full" | "sales" | "none";

/** `membership.full` reads the FULL list; `membership.sales` the SALES view (no identity); neither (or no permissions yet) reads nothing. */
export function membersModeFor(can: CanFn): MembersMode {
  if (can("membership.full")) return "full";
  if (can("membership.sales")) return "sales";
  return "none";
}

export type PlansAccess = "edit" | "read" | "none";
/** `plan.write` creates / switches plans (owner-only on the server); `plan.view` reads them. */
export function plansAccessFor(can: CanFn): PlansAccess {
  if (can("plan.write")) return "edit";
  if (can("plan.view")) return "read";
  return "none";
}

/** "Xem tại quầy" is a front-desk link: only for accounts that may open the desk (`frontDesk.clients`) AND read full member rows. Never for the sales view. */
export function canOpenFrontDesk(can: CanFn): boolean {
  return can("frontDesk.clients") && can("membership.full");
}

export interface MembersTabSpec {
  id: MembersTabId;
  label: string;
  access: "edit" | "read";
}

export function membersTabsFor(can: CanFn): MembersTabSpec[] {
  const out: MembersTabSpec[] = [];
  const mode = membersModeFor(can);
  if (mode !== "none") out.push({ id: "members", label: mode === "sales" ? "Giao dịch" : "Hội viên", access: "read" });
  const plans = plansAccessFor(can);
  if (plans !== "none") out.push({ id: "plans", label: "Gói", access: plans === "edit" ? "edit" : "read" });
  return out;
}

/** The tab to show: the requested one if the role has it, else the first it has (never a tab the role cannot read). */
export function resolveMembersTab(raw: string | null | undefined, can: CanFn): MembersTabId | null {
  const tabs = membersTabsFor(can);
  if (tabs.length === 0) return null;
  const want = parseMembersTab(raw);
  return tabs.some((t) => t.id === want) ? want : tabs[0].id;
}

export const PLANS_READONLY_NOTE = "Chỉ chủ phòng tập sửa được gói. Bạn xem được danh sách để đối chiếu.";
export const SALES_MODE_NOTE = "Kế toán xem dạng bán hàng: có giao dịch, giá và hiệu lực, không có tên hay thông tin định danh của hội viên.";

/** Render guard (05 section 6.7): data is drawn only when it was fetched for the scope that is on screen now. */
export function isCurrentScopeData(dataScopeKey: string | undefined | null, scopeKey: string): boolean {
  return !!dataScopeKey && dataScopeKey === scopeKey;
}

// ---------------------------------------------------------------------------------------------------------------------
// Membership rows
// ---------------------------------------------------------------------------------------------------------------------

export interface MemberRow {
  id: string;
  planId: string | null;
  status: string;
  /** FULL view only. Null = the server has no display name for this client (never replaced by an id). */
  clientName: string | null;
  /** FULL view only, used internally to match check-ins. NEVER rendered. */
  clientId: string | null;
  /** FULL view: the member's own code (the one they read out at the desk), when the server sends it. */
  memberCode: string | null;
  /** SALES view only (reconciliation reference). */
  paymentTxnId: string | null;
  priceAtPurchase: number;
  durationDays: number | null;
  startDate: string | null;
  endDate: string | null;
  totalVisits: number | null;
  usedVisits: number;
  createdAt: string | null;
  payoutReleasedAt: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
};

export function normalizeMemberships(raw: unknown, mode: MembersMode): MemberRow[] {
  if (mode === "none" || !Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    const x = (r ?? {}) as Record<string, unknown>;
    const id = str(x.id);
    if (!id) return [];
    const full = mode === "full";
    return [
      {
        id,
        planId: str(x.planId),
        status: str(x.status) ?? "UNKNOWN",
        clientName: full ? str(x.clientName) : null,
        clientId: full ? str(x.clientId) : null,
        memberCode: full ? str(x.memberCode) : null,
        paymentTxnId: full ? null : str(x.paymentTxnId),
        priceAtPurchase: num(x.priceAtPurchase) ?? 0,
        durationDays: num(x.durationDaysSnapshot),
        startDate: str(x.startDate),
        endDate: str(x.endDate),
        totalVisits: full ? num(x.totalVisits) : null,
        usedVisits: full ? (num(x.usedVisits) ?? 0) : 0,
        createdAt: str(x.createdAt),
        payoutReleasedAt: str(x.payoutReleasedAt),
      } satisfies MemberRow,
    ];
  });
}

export const NO_NAME_LABEL = "Hội viên chưa có tên";
export const memberDisplayName = (r: Pick<MemberRow, "clientName">): string => r.clientName ?? NO_NAME_LABEL;


const STATUS_TEXT: Record<string, { text: string; tone: TagTone }> = {
  ACTIVE: { text: "Đang hoạt động", tone: "ok" },
  PENDING_PAYMENT: { text: "Chờ thanh toán", tone: "warn" },
  PENDING_ISSUE: { text: "Có vấn đề thanh toán", tone: "risk" },
  EXPIRED: { text: "Đã hết hạn", tone: "neutral" },
  CANCELLED: { text: "Đã huỷ", tone: "neutral" },
};
export const MEMBER_STATUS_ORDER = ["ACTIVE", "PENDING_PAYMENT", "PENDING_ISSUE", "EXPIRED", "CANCELLED"] as const;

export function memberStatusTag(status: string): { text: string; tone: TagTone } {
  return STATUS_TEXT[status] ?? { text: "Chưa rõ trạng thái", tone: "neutral" };
}

const FMT_DAY = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" });
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : FMT_DAY.format(d);
}
const FMT_STAMP = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
/** "23/11 01:10" in Vietnam time, independent of the machine's timezone and locale data. */
export function formatStamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = Object.fromEntries(FMT_STAMP.formatToParts(d).map((x) => [x.type, x.value]));
  const hour = p.hour === "24" ? "00" : p.hour;
  return `${p.day}/${p.month} ${hour}:${p.minute}`;
}

const DAY_MS = 86_400_000;

/** One sentence for the "Hiệu lực" column (a state, not a date alone). */
export function validityText(r: Pick<MemberRow, "status" | "startDate" | "endDate">, nowMs: number): { main: string; sub: string } {
  const start = formatDay(r.startDate);
  const end = formatDay(r.endDate);
  if (!start && !end) return { main: r.status === "PENDING_PAYMENT" ? "Chưa kích hoạt" : "Chưa có ngày", sub: "" };
  if (r.status === "ACTIVE" && r.endDate) {
    const left = Math.ceil((new Date(r.endDate).getTime() - nowMs) / DAY_MS);
    if (Number.isFinite(left)) {
      if (left < 0) return { main: `Đến ${end}`, sub: "đã quá hạn" };
      if (left === 0) return { main: `Đến ${end}`, sub: "hết hạn hôm nay" };
      return { main: `Đến ${end}`, sub: `còn ${left} ngày` };
    }
  }
  if (start && end) return { main: `${start} đến ${end}`, sub: "" };
  return { main: end ? `Đến ${end}` : `Từ ${start}`, sub: "" };
}

export function visitsText(r: Pick<MemberRow, "totalVisits" | "usedVisits">): string {
  return r.totalVisits != null ? `${r.usedVisits}/${r.totalVisits} lượt` : `${r.usedVisits} lượt, không giới hạn`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Search, filter, sort, counts (all on the loaded list - the endpoint has no pagination)
// ---------------------------------------------------------------------------------------------------------------------

export type MemberSort = "newest" | "end-asc" | "end-desc" | "price-desc" | "price-asc";
export const MEMBER_SORTS: readonly { id: MemberSort; label: string }[] = [
  { id: "newest", label: "Mới mua nhất" },
  { id: "end-asc", label: "Hết hạn sớm nhất" },
  { id: "end-desc", label: "Hết hạn muộn nhất" },
  { id: "price-desc", label: "Giá cao đến thấp" },
  { id: "price-asc", label: "Giá thấp đến cao" },
];
export function parseMemberSort(raw: string | null | undefined): MemberSort {
  return MEMBER_SORTS.some((s) => s.id === raw) ? (raw as MemberSort) : "newest";
}

export interface MemberFilters {
  q: string;
  status: string; // "all" or a status
  planId: string; // "all" or a plan id
  sort: MemberSort;
}
export const DEFAULT_MEMBER_FILTERS: MemberFilters = { q: "", status: "all", planId: "all", sort: "newest" };

/**
 * Sales view (accountant): a payment-transaction id is an internal UUID and is never shown as text. People read a short reference,
 * "GD-" + the first 8 letters / digits, upper case ("GD-3F9A12BC"). The full id stays available only through a copy action (drawer).
 */
export function txnRef(id: string | null | undefined): string | null {
  const core = String(id ?? "").replace(/[^0-9a-z]/gi, "").slice(0, 8).toUpperCase();
  return core ? `GD-${core}` : null;
}
/** Row label / accessible name of a sales row, short form only. */
export const txnLabel = (id: string | null | undefined): string => (txnRef(id) ? `Giao dịch ${txnRef(id)}` : "Giao dịch chưa có mã");

/** Lower-case, diacritics and đ folded, so "nguyen" finds "Nguyễn". */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().trim();
}

export interface StatusSegment {
  id: string;
  label: string;
  count: number;
}

/** "Tất cả" plus every status that exists in the loaded list (a segment with 0 would only add noise). Counts ignore search/plan. */
export function statusSegments(rows: readonly MemberRow[]): StatusSegment[] {
  const out: StatusSegment[] = [{ id: "all", label: "Tất cả", count: rows.length }];
  const known = new Set<string>(MEMBER_STATUS_ORDER);
  for (const s of MEMBER_STATUS_ORDER) {
    const count = rows.filter((r) => r.status === s).length;
    if (count > 0) out.push({ id: s, label: memberStatusTag(s).text, count });
  }
  const other = rows.filter((r) => !known.has(r.status)).length;
  if (other > 0) out.push({ id: "other", label: "Khác", count: other });
  return out;
}

export function filterMembers(rows: readonly MemberRow[], f: MemberFilters, mode: MembersMode): MemberRow[] {
  const q = fold(f.q);
  const known = new Set<string>(MEMBER_STATUS_ORDER);
  return rows.filter((r) => {
    if (f.status === "other" ? known.has(r.status) : f.status !== "all" && r.status !== f.status) return false;
    if (f.planId !== "all" && r.planId !== f.planId) return false;
    if (!q) return true;
    // Full view searches by name (never by id: the id is not shown); sales view by the reconciliation reference.
    return mode === "sales" ? (fold(txnRef(r.paymentTxnId) ?? "").includes(q) || fold(r.paymentTxnId ?? "").includes(q)) : fold(r.clientName ?? "").includes(q);
  });
}

const ts = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
};

/** Sorts a copy. Rows without the sort key go last in both directions (an unknown date is not "earliest"). */
export function sortMembers(rows: readonly MemberRow[], sort: MemberSort): MemberRow[] {
  const list = [...rows];
  const byDate = (key: "endDate" | "createdAt", dir: 1 | -1) =>
    list.sort((a, b) => {
      const x = ts(a[key]);
      const y = ts(b[key]);
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x - y) * dir;
    });
  switch (sort) {
    case "end-asc":
      return byDate("endDate", 1);
    case "end-desc":
      return byDate("endDate", -1);
    case "price-desc":
      return list.sort((a, b) => b.priceAtPurchase - a.priceAtPurchase);
    case "price-asc":
      return list.sort((a, b) => a.priceAtPurchase - b.priceAtPurchase);
    default:
      return byDate("createdAt", -1);
  }
}

export function applyMemberView(rows: readonly MemberRow[], f: MemberFilters, mode: MembersMode): MemberRow[] {
  return sortMembers(filterMembers(rows, f, mode), f.sort);
}

export function hasActiveFilters(f: MemberFilters): boolean {
  return f.q.trim() !== "" || f.status !== "all" || f.planId !== "all";
}

/** Rows per request of the paged list (the server allows up to 500; 100 keeps the first paint light). */
export const MEMBERS_PAGE_SIZE = 100;

/** The note under the table (G5, server paging): how many rows are loaded and whether the server has more; the sort is the server's. */
export function pageSummary(loaded: number, hasMore: boolean, mode: MembersMode, statusId: string): string {
  const noun = mode === "sales" ? "giao dịch" : "hội viên";
  const scope = statusId === "all" ? "" : ` thuộc nhóm "${statusLabel(statusId)}"`;
  return hasMore
    ? `Đã tải ${loaded} ${noun}${scope}, mới nhất trước. Bấm "Xem thêm" để tải tiếp.`
    : `Đã tải hết ${loaded} ${noun}${scope}, mới nhất trước.`;
}

/** Status segments of the server-side filter. `counts` = `stats.memberships.byStatus` when the server returned it, else null (no number is drawn). */
export interface ServerSegment {
  id: string;
  label: string;
  /** From the server only; null = unknown (stats not loaded, failed, or this role has no such block). */
  count: number | null;
}
export const statusLabel = (status: string): string => STATUS_TEXT[status]?.text ?? status;

export function serverSegments(byStatus: Readonly<Record<string, number>> | null | undefined): ServerSegment[] {
  const out: ServerSegment[] = [];
  const total = byStatus ? Object.values(byStatus).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0) : null;
  out.push({ id: "all", label: "Tất cả", count: total });
  for (const st of MEMBER_STATUS_ORDER) {
    const c = byStatus ? byStatus[st] : undefined;
    // With counts: a status the server counted 0 for is left out (noise). Without counts: every filterable status is offered, unnumbered.
    if (byStatus && !(typeof c === "number" && c > 0)) continue;
    out.push({ id: st, label: statusLabel(st), count: byStatus ? (c as number) : null });
  }
  return out;
}

/** What the filter sends: nothing for "Tất cả", else the status (a value the server accepts, MEMBER_STATUS_ORDER). */
export function statusParamOf(segmentId: string): string | undefined {
  return (MEMBER_STATUS_ORDER as readonly string[]).includes(segmentId) ? segmentId : undefined;
}

// ---------------------------------------------------------------------------------------------------------------------
// Member drawer: check-ins of the member from the branch's latest 50
// ---------------------------------------------------------------------------------------------------------------------

export const CHECKIN_WINDOW = 50;
export const CHECKIN_LIMIT_NOTE = `Lấy từ ${CHECKIN_WINDOW} lượt check-in gần nhất của cả chi nhánh. Máy chủ chưa lọc theo hội viên và chưa phân trang, nên lượt cũ hơn có thể không hiện ở đây.`;

export interface CheckinItem {
  id: string;
  at: string;
  source: "QR" | "ASSISTED" | null;
}

export function checkinSourceLabel(source: CheckinItem["source"]): string {
  return source === "ASSISTED" ? "Check-in hộ" : source === "QR" ? "Quét mã QR" : "Check-in";
}

function normalizeCheckin(raw: unknown): (CheckinItem & { clientId: string | null; membershipId: string | null }) | null {
  const x = (raw ?? {}) as Record<string, unknown>;
  const id = str(x.id);
  const at = str(x.createdAt);
  if (!id || !at) return null;
  return { id, at, source: x.source === "ASSISTED" ? "ASSISTED" : x.source === "QR" ? "QR" : null, clientId: str(x.clientId), membershipId: str(x.membershipId) };
}

/** Newest first. Matches by client id (a person can hold several memberships). Empty when the row has no client id (SALES view). */
export function checkinsOfMember(raw: unknown, member: Pick<MemberRow, "clientId">, limit = 8): CheckinItem[] {
  if (!member.clientId || !Array.isArray(raw)) return [];
  return raw
    .map(normalizeCheckin)
    .filter((c): c is NonNullable<ReturnType<typeof normalizeCheckin>> => !!c && c.clientId === member.clientId)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit)
    .map(({ id, at, source }) => ({ id, at, source }));
}

/** Same, matched by membership id (used by the exception drawer, whose row names the membership). */
export function checkinsOfMembership(raw: unknown, membershipId: string | null, limit = 8): CheckinItem[] {
  if (!membershipId || !Array.isArray(raw)) return [];
  return raw
    .map(normalizeCheckin)
    .filter((c): c is NonNullable<ReturnType<typeof normalizeCheckin>> => !!c && c.membershipId === membershipId)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit)
    .map(({ id, at, source }) => ({ id, at, source }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Plans (brand-wide)
// ---------------------------------------------------------------------------------------------------------------------

export interface PlanRow {
  id: string;
  name: string;
  price: number;
  durationDays: number;
  visitLimit: number | null;
  status: "ACTIVE" | "INACTIVE";
  saleStartAt: string | null;
  saleEndAt: string | null;
}

export function normalizePlans(raw: unknown): PlanRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    const x = (r ?? {}) as Record<string, unknown>;
    const id = str(x.id);
    if (!id) return [];
    return [
      {
        id,
        name: str(x.name) ?? "Gói chưa đặt tên",
        price: num(x.price) ?? 0,
        durationDays: num(x.durationDays) ?? 0,
        visitLimit: num(x.visitLimit),
        status: x.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
        saleStartAt: str(x.saleStartAt),
        saleEndAt: str(x.saleEndAt),
      } satisfies PlanRow,
    ];
  });
}

/** Plan name for a membership row; a plan the list does not know is said so, never an id. */
export function planNameOf(planId: string | null, plans: readonly PlanRow[]): string {
  return plans.find((p) => p.id === planId)?.name ?? "Gói không còn trong danh sách";
}

/** Owner-facing label of a plan's marketing window - the same rule as the legacy page (mirrors gym-service isPlanOnSale). */
export function saleWindowLabel(plan: Pick<PlanRow, "saleStartAt" | "saleEndAt">, now: Date): { text: string; tone: TagTone } | null {
  if (!plan.saleStartAt && !plan.saleEndAt) return null;
  if (plan.saleStartAt && now < new Date(plan.saleStartAt)) return { text: `Mở bán từ ${new Date(plan.saleStartAt).toLocaleDateString("vi-VN")}`, tone: "info" };
  if (plan.saleEndAt && now > new Date(plan.saleEndAt)) return { text: "Đã hết hạn bán", tone: "neutral" };
  const until = plan.saleEndAt ? ` đến ${new Date(plan.saleEndAt).toLocaleDateString("vi-VN")}` : "";
  return { text: `Đang mở bán${until}`, tone: "ok" };
}

export function planStatusTag(status: PlanRow["status"]): { text: string; tone: TagTone } {
  return status === "ACTIVE" ? { text: "Đang bán", tone: "ok" } : { text: "Đã ngừng", tone: "neutral" };
}

export function planLimitText(visitLimit: number | null): string {
  return visitLimit ? `${visitLimit} lượt, dùng chung mọi chi nhánh` : "Không giới hạn lượt";
}

export interface PlanForm {
  name: string;
  price: string;
  durationDays: string;
  visitLimit: string;
  saleStartAt: string;
  saleEndAt: string;
}
export const EMPTY_PLAN_FORM: PlanForm = { name: "", price: "", durationDays: "30", visitLimit: "", saleStartAt: "", saleEndAt: "" };

export type PlanFormErrors = Partial<Record<keyof PlanForm, string>>;
export const PRICE_CEILING = 1_000_000_000;

/**
 * Same bounds as gym-service `plan.schemas.ts` (name 2-100, price > 0 and <= 1e9, whole days 1-3650, visit limit a positive
 * whole number or empty, sale start <= end). The server stays the authority; this only says it before the request.
 */
export function validatePlanForm(f: PlanForm): { ok: boolean; errors: PlanFormErrors } {
  const errors: PlanFormErrors = {};
  const name = f.name.trim();
  if (name.length < 2 || name.length > 100) errors.name = "Tên gói phải từ 2 đến 100 ký tự.";
  const price = Number(f.price);
  if (!f.price.trim() || !Number.isFinite(price) || price <= 0) errors.price = "Giá phải lớn hơn 0.";
  else if (price > PRICE_CEILING) errors.price = "Giá không được vượt quá 1.000.000.000 đ.";
  const days = Number(f.durationDays);
  if (!f.durationDays.trim() || !Number.isInteger(days) || days < 1 || days > 3650) errors.durationDays = "Thời hạn phải là số ngày nguyên từ 1 đến 3650.";
  if (f.visitLimit.trim()) {
    const v = Number(f.visitLimit);
    if (!Number.isInteger(v) || v <= 0) errors.visitLimit = "Giới hạn lượt phải là số nguyên lớn hơn 0, hoặc để trống nếu không giới hạn.";
  }
  if (f.saleStartAt && f.saleEndAt && f.saleStartAt > f.saleEndAt) errors.saleEndAt = "Ngày bắt đầu mở bán phải trước hoặc bằng ngày kết thúc.";
  return { ok: Object.keys(errors).length === 0, errors };
}

/** Create payload: the shape the legacy page sent (`gymService.createPlan`), with the name trimmed. */
export function createPlanPayload(f: PlanForm) {
  return {
    name: f.name.trim(),
    price: Number(f.price),
    durationDays: Number(f.durationDays),
    visitLimit: f.visitLimit.trim() ? Number(f.visitLimit) : undefined,
    saleStartAt: f.saleStartAt || undefined,
    saleEndAt: f.saleEndAt || undefined,
  };
}

/**
 * True when the create form holds anything typed (the discard guard). Plans are create + switch on/off only in the new UI,
 * exactly like the legacy page: editing a plan (price included) is a product decision that has not been taken.
 */
export function planFormDirty(f: PlanForm): boolean {
  return (Object.keys(EMPTY_PLAN_FORM) as (keyof PlanForm)[]).some((k) => f[k].trim() !== EMPTY_PLAN_FORM[k].trim());
}

/** The server's own sentence when it sends one (plan.schemas.ts messages are Vietnamese), else a plain fallback. */
export function planErrorMessage(err: unknown, fallback: string): string {
  const m = (err as { response?: { data?: { error?: { message?: unknown } } } })?.response?.data?.error?.message;
  return typeof m === "string" && m.trim() ? m : fallback;
}
