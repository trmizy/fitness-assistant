/**
 * Quầy lễ tân (batch G3) - pure model, no React. Tab <-> URL (including the `?exception=<id>` deep link), what each role gets, the
 * exception list/drawer view model, the decision rules (reason 5-300, who may decide) and the plain-Vietnamese sentence for every
 * refusal the server can answer an approve / reject with (docs/gym-owner-redesign/audit/03 section C).
 *
 * The server stays the authority for every rule here (four eyes `decided_by <> requested_by`, end-of-day expiry, one decision per
 * request, single use). This module only decides what the screen says and offers BEFORE and AFTER the request.
 */
import type { PartnerRole } from "../../../utils/gymStaffRole";
import type { ExceptionRow } from "../../../utils/assistedCheckin";
import type { TagTone } from "../scope/scopeModel";

// ---------------------------------------------------------------------------------------------------------------------
// Tabs and URL: /gym-owner/front-desk?gymId=&tab=checkin|exceptions|pt&exception=<id>
// ---------------------------------------------------------------------------------------------------------------------

export const FD_TAB_IDS = ["checkin", "exceptions", "pt"] as const;
export type FdTabId = (typeof FD_TAB_IDS)[number];

export const FD_TAB_LABEL: Record<FdTabId, string> = {
  checkin: "Tìm & check-in",
  exceptions: "Ngoại lệ",
  pt: "PT hôm nay",
};

/** An `exception` id with no (or an unknown) `tab` opens the Ngoại lệ tab: that is what the "Xem ngoại lệ" button of Hôm nay needs. */
export function parseFdTab(tab: string | null | undefined, exceptionId?: string | null): FdTabId {
  if (tab && (FD_TAB_IDS as readonly string[]).includes(tab)) return tab as FdTabId;
  return exceptionId ? "exceptions" : "checkin";
}

export interface FdUrlState {
  gymId?: string | null;
  tab: FdTabId;
  exceptionId?: string | null;
  /** "Xem tại quầy" from a member row: pre-fills the member code of the check-in search (nothing is searched or sent). */
  code?: string | null;
}

export function fdSearch(s: FdUrlState): string {
  const sp = new URLSearchParams();
  if (s.gymId) sp.set("gymId", s.gymId);
  sp.set("tab", s.tab);
  if (s.tab === "exceptions" && s.exceptionId) sp.set("exception", s.exceptionId);
  if (s.tab === "checkin" && s.code) sp.set("code", s.code);
  return `?${sp.toString()}`;
}

/** Deep link from Hôm nay straight to one exception of one branch. */
export function exceptionDeepLink(gymId: string, exceptionId: string): string {
  return `/gym-owner/front-desk${fdSearch({ gymId, tab: "exceptions", exceptionId })}`;
}

export function frontDeskHref(gymId: string, tab: FdTabId = "checkin", code?: string | null): string {
  return `/gym-owner/front-desk${fdSearch({ gymId, tab, code })}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Roles (audit/02: front desk O,M,R; exception approve O,M; request O,M,R; a receptionist sees only their own)
// ---------------------------------------------------------------------------------------------------------------------

export function canUseDesk(role: PartnerRole | undefined): boolean {
  return role === "OWNER" || role === "MANAGER" || role === "RECEPTIONIST";
}

/**
 * Who is offered Duyệt / Từ chối. Needs the ROLE (owner, manager) AND the server's own `canApprove` answer; a receptionist never
 * is, whatever the list says. Hiding is a courtesy: the server refuses everyone else with 403 PERMISSION_DENIED.
 */
export function canDecide(role: PartnerRole | undefined, canApprove: boolean): boolean {
  return canApprove && (role === "OWNER" || role === "MANAGER");
}

/** Receptionist: the exception tab is "Ngoại lệ của bạn" and only lists their own requests. */
export function exceptionsHeading(canApprove: boolean): { title: string; sub: string } {
  return canApprove
    ? { title: "Ngoại lệ check-in", sub: "Yêu cầu chờ quản lý hoặc chủ phòng tập duyệt. Người duyệt phải khác người xin." }
    : { title: "Ngoại lệ của bạn", sub: "Bạn chỉ thấy các yêu cầu do chính bạn xin. Chỉ quản lý hoặc chủ phòng tập duyệt được." };
}

// ---------------------------------------------------------------------------------------------------------------------
// Exceptions list
// ---------------------------------------------------------------------------------------------------------------------

const FMT_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" });
/** Calendar day (YYYY-MM-DD) in Vietnam, independent of the machine's timezone. */
export const vnDay = (ms: number): string => FMT_DAY.format(new Date(ms));

const parseMs = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
};

/** A PENDING request past its end-of-day expiry can no longer be decided (the server answers 410), so it is not "waiting". */
export function isOpenPending(e: Pick<ExceptionRow, "status" | "expiresAt">, nowMs: number): boolean {
  if (e.status !== "PENDING") return false;
  const exp = parseMs(e.expiresAt);
  return exp === null || exp >= nowMs;
}

export function pendingCount(rows: readonly ExceptionRow[], nowMs: number): number {
  return rows.filter((r) => isOpenPending(r, nowMs)).length;
}

export type ExceptionFilter = "pending" | "all";
export function filterExceptions(rows: readonly ExceptionRow[], filter: ExceptionFilter, nowMs: number): ExceptionRow[] {
  const list = filter === "pending" ? rows.filter((r) => isOpenPending(r, nowMs)) : [...rows];
  // Oldest request first among the waiting ones (it has waited longest); the full list newest first.
  return list.sort((a, b) => {
    const x = parseMs(a.createdAt) ?? 0;
    const y = parseMs(b.createdAt) ?? 0;
    return filter === "pending" ? x - y : y - x;
  });
}

export function findException(rows: readonly ExceptionRow[], id: string | null | undefined): ExceptionRow | null {
  return id ? (rows.find((r) => r.id === id) ?? null) : null;
}

/** "Hết hạn" column and drawer line: requests expire at the end of the local day they were made. */
export function expiryText(e: Pick<ExceptionRow, "status" | "expiresAt">, nowMs: number): string {
  const exp = parseMs(e.expiresAt);
  if (e.status === "USED") return "Đã dùng, hết hiệu lực";
  if (e.status === "REJECTED") return "Không còn hiệu lực";
  if (e.status === "EXPIRED") return "Đã hết hạn";
  if (exp === null) return "Cuối ngày";
  if (exp < nowMs) return "Đã hết hạn";
  return vnDay(exp) === vnDay(nowMs) ? "Cuối ngày hôm nay" : `Hết hạn ${vnDay(exp).split("-").reverse().join("/")}`;
}

const STATUS_TAG: Record<ExceptionRow["status"], { text: string; tone: TagTone }> = {
  PENDING: { text: "Chờ duyệt", tone: "warn" },
  APPROVED: { text: "Đã duyệt", tone: "ok" },
  REJECTED: { text: "Bị từ chối", tone: "risk" },
  EXPIRED: { text: "Hết hạn", tone: "neutral" },
  USED: { text: "Đã dùng", tone: "neutral" },
};
export function exceptionTag(status: ExceptionRow["status"]): { text: string; tone: TagTone } {
  return STATUS_TAG[status] ?? STATUS_TAG.PENDING;
}

/** Rules shown in the drawer's investigation part (audit/03 section C: four eyes, end-of-day expiry, single use). */
export const EXCEPTION_RULES: readonly string[] = [
  "Người duyệt phải khác người xin.",
  "Hết hạn vào cuối ngày hôm nay.",
  "Dùng được một lần.",
];

export const EXCEPTION_NOT_FOUND_NOTE = "Không tìm thấy yêu cầu ngoại lệ này ở chi nhánh đang xem. Có thể nó đã hết hạn từ hôm qua hoặc thuộc chi nhánh khác.";

// ---------------------------------------------------------------------------------------------------------------------
// Decision (approve / reject): reason 5-300, confirmation text, refusal sentences
// ---------------------------------------------------------------------------------------------------------------------

export const REASON_MIN = 5;
export const REASON_MAX = 300;
export type DecisionVerb = "approve" | "reject";

/** "12/300" - the raw length, so the person sees what they typed. */
export const reasonCounter = (reason: string): string => `${reason.length}/${REASON_MAX}`;

/** null = acceptable. The server trims and checks 5-300 itself (400 REASON_REQUIRED). */
export function reasonProblem(reason: string): string | null {
  const n = reason.trim().length;
  if (n < REASON_MIN) return `Cần ghi lý do, ít nhất ${REASON_MIN} ký tự.`;
  if (reason.length > REASON_MAX) return `Lý do tối đa ${REASON_MAX} ký tự.`;
  return null;
}

export const verbLabel = (v: DecisionVerb): { action: string; confirm: string; doing: string; done: string; reasonLabel: string; placeholder: string } =>
  v === "approve"
    ? { action: "Duyệt", confirm: "Xác nhận duyệt", doing: "Đang gửi", done: "Đã duyệt", reasonLabel: "Lý do duyệt", placeholder: "Bạn đã xác minh bằng cách nào? (ít nhất 5 ký tự)" }
    : { action: "Từ chối", confirm: "Xác nhận từ chối", doing: "Đang gửi", done: "Đã từ chối", reasonLabel: "Lý do từ chối", placeholder: "Vì sao từ chối? (ít nhất 5 ký tự)" };

/** The confirmation dialog names the branch and the member (06 section 3: "Duyệt ngoại lệ check-in cho Nguyễn An tại Q1"). */
export function confirmTitle(verb: DecisionVerb, memberName: string, branchName: string): string {
  return `${verb === "approve" ? "Duyệt" : "Từ chối"} ngoại lệ check-in cho ${memberName} tại ${branchName}`;
}

export function confirmBody(verb: DecisionVerb): string {
  return verb === "approve"
    ? "Hội viên sẽ được check-in hộ một lần, chỉ trong hôm nay. Lý do của bạn được ghi lại cùng tên bạn."
    : "Yêu cầu sẽ bị từ chối và lễ tân phải xin lại nếu vẫn cần. Lý do của bạn được ghi lại cùng tên bạn.";
}

export interface DecisionRefusal {
  /** What the person reads (never a code). */
  text: string;
  /** The list is stale (somebody else decided / it expired): reload it. */
  reload: boolean;
  /** Sending the same thing again can still work (typing a better reason, a slow network). False = the answer will not change. */
  retry: boolean;
}

const CODE_TEXT: Record<string, DecisionRefusal> = {
  EXCEPTION_SELF_APPROVAL: { text: "Bạn không thể tự duyệt yêu cầu do chính mình xin. Hãy nhờ chủ phòng tập hoặc một quản lý khác quyết định.", reload: false, retry: false },
  EXCEPTION_ALREADY_DECIDED: { text: "Yêu cầu này vừa được người khác xử lý hoặc đã được dùng. Danh sách đã được tải lại để bạn xem kết quả mới.", reload: true, retry: false },
  EXCEPTION_EXPIRED: { text: "Yêu cầu này đã hết hạn vì chỉ có hiệu lực trong ngày. Lễ tân cần xin yêu cầu mới.", reload: true, retry: false },
  EXCEPTION_NOT_FOUND: { text: "Không tìm thấy yêu cầu này ở chi nhánh đang xem. Danh sách đã được tải lại.", reload: true, retry: false },
  REASON_REQUIRED: { text: `Cần ghi lý do, ít nhất ${REASON_MIN} ký tự.`, reload: false, retry: true },
  VALIDATION_ERROR: { text: `Lý do chưa hợp lệ. Hãy ghi từ ${REASON_MIN} đến ${REASON_MAX} ký tự.`, reload: false, retry: true },
  PERMISSION_DENIED: { text: "Vai trò của bạn không có quyền duyệt hay từ chối ngoại lệ.", reload: false, retry: false },
  OWNER_ROLE_REQUIRED: { text: "Vai trò của bạn không có quyền duyệt hay từ chối ngoại lệ.", reload: false, retry: false },
  GYM_OUT_OF_SCOPE: { text: "Bạn không được giao chi nhánh này nên không thể duyệt ở đây.", reload: false, retry: false },
  PARTNER_SUSPENDED: { text: "Đối tác đang bị đình chỉ nên chưa thực hiện được. Vui lòng liên hệ hỗ trợ Gymini.", reload: false, retry: false },
};

/** Server answer -> sentence. By code first, then by HTTP status (403 / 409 / 410), then a plain fallback. */
export function decisionRefusal(err: unknown): DecisionRefusal {
  const r = (err as { response?: { status?: number; data?: { error?: { code?: string } } } } | null)?.response;
  const code = r?.data?.error?.code;
  if (code && CODE_TEXT[code]) return CODE_TEXT[code];
  if (r?.status === 410) return CODE_TEXT.EXCEPTION_EXPIRED;
  if (r?.status === 409) return CODE_TEXT.EXCEPTION_ALREADY_DECIDED;
  if (r?.status === 403) return { text: "Bạn không có quyền thực hiện việc này.", reload: false, retry: false };
  if (r?.status === 429) return { text: "Thao tác quá nhanh. Vui lòng đợi một chút rồi thử lại.", reload: false, retry: true };
  if (!r) return { text: "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.", reload: false, retry: true };
  return { text: "Có lỗi xảy ra. Vui lòng thử lại.", reload: false, retry: true };
}

// ---------------------------------------------------------------------------------------------------------------------
// Leaving with unsent input (branch switch, navigation)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Ask before leaving only when something typed would be lost AND the move changes the branch or the page. Switching tab or
 * opening a drawer inside the same branch keeps the input (the check-in tab stays mounted), so it never asks.
 * G4: a typed DECISION reason lives in the exception drawer, which is the `exception` URL param, so any move that changes or drops
 * that param asks too (Back to the same branch included). Closing the drawer by its own button / Esc asks in the drawer itself
 * and then passes a force flag, so nobody is asked twice.
 */
export function shouldAskBeforeLeaving(p: {
  dirty: boolean;
  /** A decision reason is typed in the exception drawer (a subset of `dirty`). */
  decisionDirty?: boolean;
  from: { pathname: string; search: string };
  to: { pathname: string; search: string };
}): boolean {
  if (!p.dirty) return false;
  if (p.from.pathname !== p.to.pathname) return true;
  const fa = new URLSearchParams(p.from.search);
  const ta = new URLSearchParams(p.to.search);
  if (fa.get("gymId") !== ta.get("gymId")) return true;
  if (p.decisionDirty && fa.get("exception") !== ta.get("exception")) return true;
  return false;
}
