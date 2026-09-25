/**
 * Phase 10 — pure parts of the PT workspace (PT-01 Tổng quan, PT-02 Học viên, PT-04 Lịch dạy,
 * PT-05 Ví, PT-06 Hồ sơ). Shapes are the real user-service / payment-service answers behind
 * web's PTDashboard, PTClientList, PTSchedulePage, PTWalletPage and PTProfilePage.
 *
 * Status wording is the one thing that cannot be shared with the client screens: the enums are
 * the same (`ContractStatus`, `SessionStatus` — see features/services/{contracts,sessions}.ts,
 * still the only place those enums are interpreted), but every side-dependent label reads from
 * the other chair. "Chờ PT xác nhận" is what the CLIENT sees; the PT sees "Bạn cần xác nhận".
 * So the maps below override only the side-dependent entries and fall back to the shared ones —
 * a new enum value keeps working and keeps its tone, it just reads neutrally until it is given
 * PT wording here.
 */
import { CONTRACT_STATUS, type StatusTone } from "../services/contracts";
import { SESSION_STATUS, type SessionTone } from "../services/sessions";
import { GOAL_OPTIONS } from "../profile/profile";

// ── Naming a client ────────────────────────────────────────────────────────────────────────

/** Both shapes the backend uses: the joined profile, or the legacy flat name. */
export type ClientRef = {
  clientProfile?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
  clientName?: string | null;
};

export function clientName(ref: ClientRef | null | undefined, fallback = "Học viên"): string {
  const p = ref?.clientProfile;
  if (p) {
    const name = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
    if (name) return name;
  }
  return ref?.clientName?.trim() || fallback;
}

/** Initials for the avatar. Never renders an id — "?" is better than a uuid fragment. */
export function clientInitials(ref: ClientRef | null | undefined): string {
  const p = ref?.clientProfile;
  if (p) {
    const i = `${p.firstName?.[0] ?? ""}${p.lastName?.[0] ?? ""}`.trim();
    if (i) return i.toUpperCase();
  }
  const name = ref?.clientName?.trim();
  if (!name) return "?";
  const parts = name.split(/\s+/);
  return (parts.length >= 2 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : parts[0].slice(0, 2)).toUpperCase();
}

export function goalLabel(goal: string | null | undefined): string {
  if (!goal) return "Chưa đặt mục tiêu";
  return GOAL_OPTIONS.find((g) => g.value === goal)?.label ?? goal.replace(/_/g, " ").toLowerCase();
}

// ── Status, read from the trainer's chair ──────────────────────────────────────────────────

const PT_CONTRACT_OVERRIDE: Record<string, { label: string; tone: StatusTone; note?: string }> = {
  PENDING_REVIEW: { label: "Bạn cần duyệt", tone: "warning", note: "Học viên đang chờ bạn nhận hợp đồng." },
  PENDING_PAYMENT: { label: "Chờ học viên trả", tone: "warning", note: "Bạn đã nhận — học viên chưa thanh toán." },
  PENDING_SIGNATURE: { label: "Chờ ký", tone: "warning", note: "Hợp đồng đang chờ hai bên ký điện tử." },
  REJECTED: { label: "Bạn đã từ chối", tone: "danger" },
};

export function ptContractStatus(status: string) {
  return (
    PT_CONTRACT_OVERRIDE[status] ??
    CONTRACT_STATUS[status] ?? { label: status || "Không rõ", tone: "neutral" as StatusTone }
  );
}

const PT_SESSION_OVERRIDE: Record<string, { label: string; tone: SessionTone; note?: string }> = {
  REQUESTED: { label: "Bạn cần xác nhận", tone: "warning", note: "Học viên đã đặt buổi này và đang chờ bạn." },
  PENDING_CLIENT_CONFIRMATION: {
    label: "Chờ học viên xác nhận",
    tone: "warning",
    note: "Bạn đã báo dạy xong. Quá hạn mà học viên không phản hồi thì hệ thống tự xác nhận.",
  },
  PT_NO_SHOW_REPORTED: {
    label: "Học viên báo bạn vắng",
    tone: "danger",
    note: "Hãy phản hồi báo cáo này — im lặng bị tính là đồng ý.",
  },
  NO_SHOW: { label: "Học viên vắng", tone: "danger" },
};

export function ptSessionStatus(status: string) {
  return (
    PT_SESSION_OVERRIDE[status] ??
    SESSION_STATUS[status] ?? { label: status || "Không rõ", tone: "neutral" as SessionTone }
  );
}

// ── Roster (PT-02) ─────────────────────────────────────────────────────────────────────────

export type PtContract = ClientRef & {
  id: string;
  clientUserId: string;
  status: string;
  packageName?: string | null;
  totalSessions?: number | null;
  usedSessions?: number | null;
  price?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  createdAt?: string | null;
  clientProfile?: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    goal?: string | null;
    currentWeight?: number | null;
    targetWeight?: number | null;
  } | null;
};

export type StudentRow = {
  contractId: string;
  clientUserId: string;
  name: string;
  initials: string;
  goal: string;
  status: string;
  packageName: string;
  used: number;
  total: number;
  /** 0..1, clamped — a contract can log more sessions than the package if a PT over-delivers. */
  progress: number;
  endDate: string | null;
};

export function studentsFromContracts(contracts: unknown): StudentRow[] {
  const list: PtContract[] = Array.isArray(contracts) ? (contracts as PtContract[]) : [];
  return list
    .filter((c) => c?.id)
    .map((c) => {
      const total = Number(c.totalSessions ?? 0);
      const used = Number(c.usedSessions ?? 0);
      return {
        contractId: c.id,
        clientUserId: c.clientUserId,
        name: clientName(c),
        initials: clientInitials(c),
        goal: goalLabel(c.clientProfile?.goal),
        status: c.status,
        packageName: c.packageName?.trim() || "Gói huấn luyện",
        used,
        total,
        progress: total > 0 ? Math.max(0, Math.min(1, used / total)) : 0,
        endDate: c.endDate ?? null,
      };
    });
}

/**
 * Filters mirror web's, in Vietnamese and collapsed for a phone: web offers five chips
 * (All/Active/Pending/Completed/Expired) but Completed and Expired mean the same thing to a
 * trainer looking at a roster — the relationship is over — so they share one chip.
 */
export const STUDENT_FILTERS = [
  { key: "active", label: "Đang tập", statuses: ["ACTIVE"] },
  { key: "pending", label: "Chờ xử lý", statuses: ["PENDING_REVIEW", "PENDING_SIGNATURE", "PENDING_PAYMENT"] },
  { key: "done", label: "Đã xong", statuses: ["COMPLETED", "EXPIRED", "CANCELLED", "REJECTED"] },
  { key: "all", label: "Tất cả", statuses: [] },
] as const;

export type StudentFilterKey = (typeof STUDENT_FILTERS)[number]["key"];

export function filterStudents(rows: StudentRow[], query: string, filter: StudentFilterKey): StudentRow[] {
  const q = query.trim().toLowerCase();
  const allowed = STUDENT_FILTERS.find((f) => f.key === filter)?.statuses ?? [];
  return rows.filter((r) => {
    if (allowed.length && !allowed.includes(r.status as never)) return false;
    if (!q) return true;
    return r.name.toLowerCase().includes(q) || r.packageName.toLowerCase().includes(q);
  });
}

/** Tab counts sit next to the chips, so an empty tab is obvious before it is tapped. */
export function studentCounts(rows: StudentRow[]): Record<StudentFilterKey, number> {
  const out = { active: 0, pending: 0, done: 0, all: rows.length } as Record<StudentFilterKey, number>;
  for (const f of STUDENT_FILTERS) {
    if (f.key === "all") continue;
    out[f.key] = rows.filter((r) => (f.statuses as readonly string[]).includes(r.status)).length;
  }
  return out;
}

// ── Contracts (PT-07) ──────────────────────────────────────────────────────────────────────

/**
 * Four groups, in the order a trainer works through them. Note what is NOT here: the design's
 * "ký hợp đồng" step. Accepting goes PENDING_REVIEW → PENDING_PAYMENT directly because e-signing
 * is off (`REQUIRE_CONTRACT_ESIGN=false`, a settled decision — contract.service.ts picks the
 * claim target from that flag). PENDING_SIGNATURE is still grouped under "Đang chờ" so a
 * deployment that turns e-sign back on shows those contracts instead of hiding them, but no
 * signing UI is invented for a step that does not currently happen.
 */
export const CONTRACT_TABS = [
  { key: "requests", label: "Yêu cầu", statuses: ["PENDING_REVIEW"] },
  { key: "waiting", label: "Đang chờ", statuses: ["PENDING_SIGNATURE", "PENDING_PAYMENT"] },
  { key: "active", label: "Đang dạy", statuses: ["ACTIVE"] },
  { key: "ended", label: "Kết thúc", statuses: ["COMPLETED", "EXPIRED", "CANCELLED", "REJECTED"] },
] as const;

export type ContractTabKey = (typeof CONTRACT_TABS)[number]["key"];

export function contractsInTab(contracts: unknown, tab: ContractTabKey): PtContract[] {
  const allowed = CONTRACT_TABS.find((t) => t.key === tab)?.statuses ?? [];
  return (Array.isArray(contracts) ? (contracts as PtContract[]) : [])
    .filter((c) => c?.id && (allowed as readonly string[]).includes(c.status))
    .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
}

export function contractTabCounts(contracts: unknown): Record<ContractTabKey, number> {
  const list = Array.isArray(contracts) ? (contracts as PtContract[]) : [];
  const out = {} as Record<ContractTabKey, number>;
  for (const t of CONTRACT_TABS) {
    out[t.key] = list.filter((c) => (t.statuses as readonly string[]).includes(c.status)).length;
  }
  return out;
}

/** The design's four canned reasons; a trainer can still type their own. */
export const REJECT_REASONS = [
  "Lịch dạy đã kín",
  "Mục tiêu ngoài chuyên môn",
  "Địa điểm không phù hợp",
  "Mức giá chưa phù hợp",
];

// ── Dashboard (PT-01) ──────────────────────────────────────────────────────────────────────

export type PtSession = ClientRef & {
  id: string;
  clientUserId?: string;
  ptUserId?: string;
  scheduledStartAt: string;
  scheduledEndAt?: string | null;
  status: string;
  sessionMode?: string | null;
};

export function sessionsOf(data: unknown): PtSession[] {
  return (Array.isArray(data) ? (data as PtSession[]) : []).filter((s) => s?.id && s?.scheduledStartAt);
}

/** Monday 00:00 of the week containing `d` (Vietnamese weeks start on Monday). */
export function mondayOf(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day));
  date.setHours(0, 0, 0, 0);
  return date;
}

export const DAY_LABELS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

/** Seven counts, Monday→Sunday, for the week starting at `monday`. */
export function weekSessionCounts(sessions: PtSession[], monday: Date): number[] {
  return DAY_LABELS.map((_, i) => {
    const from = new Date(monday);
    from.setDate(monday.getDate() + i);
    const to = new Date(from.getTime() + 86_400_000);
    return sessions.filter((s) => {
      const t = new Date(s.scheduledStartAt).getTime();
      return t >= from.getTime() && t < to.getTime();
    }).length;
  });
}

/** Web's KPI: only the two statuses that still oblige the trainer to show up. */
export function liveSessionCount(sessions: PtSession[]): number {
  return sessions.filter((s) => s.status === "REQUESTED" || s.status === "CONFIRMED").length;
}

export type PtAlert = { key: string; tone: "warning" | "info" | "danger"; text: string; route?: string };

/**
 * Same three sources web shows, in this order of urgency: sessions the client booked and the PT
 * has not confirmed, contracts waiting on the PT, contracts about to expire. Plan reviews are
 * added by the screen (Phase 11 owns that route) so this stays free of navigation.
 */
export function ptAlerts(
  contracts: unknown,
  sessions: PtSession[],
  now: Date = new Date(),
): PtAlert[] {
  const list: PtContract[] = Array.isArray(contracts) ? (contracts as PtContract[]) : [];
  const out: PtAlert[] = [];

  const toConfirm = sessions.filter((s) => s.status === "REQUESTED").length;
  if (toConfirm > 0) {
    out.push({
      key: "sessions-to-confirm",
      tone: "warning",
      text: `${toConfirm} buổi tập đang chờ bạn xác nhận`,
      route: "/pt/schedule",
    });
  }

  const pending = list.filter((c) => c.status === "PENDING_REVIEW").length;
  if (pending > 0) {
    out.push({
      key: "contracts-pending",
      tone: "info",
      text: `${pending} yêu cầu hợp đồng đang chờ bạn duyệt`,
      route: "/pt/contracts",
    });
  }

  const in7Days = new Date(now.getTime() + 7 * 86_400_000);
  for (const c of list) {
    if (c.status !== "ACTIVE" || !c.endDate) continue;
    const end = new Date(c.endDate);
    if (Number.isNaN(end.getTime()) || end > in7Days || end < now) continue;
    out.push({
      key: `expiring-${c.id}`,
      tone: "warning",
      text: `Hợp đồng của ${clientName(c)} hết hạn trong 7 ngày tới`,
      route: "/pt/students",
    });
  }

  return out;
}

// ── Schedule (PT-04) ───────────────────────────────────────────────────────────────────────

/**
 * user-service speaks two dialects of the same weekday: `GET /availability/:id` returns the
 * Prisma enum ("MONDAY"), while `PUT /availability/me` normalizes whatever it is given — it was
 * built to accept the PT application wizard's abbreviated "Mon" (see availability.service.ts's
 * DAY_NAME_NORMALIZE and the comment above it). Mobile therefore keeps ONE internal form, the
 * wizard's "Mon".."Sun" (features/ptApplication/ptApplication.ts owns that list and the block
 * validation), and converts on the way in. Reusing that module is deliberate: a second weekday
 * list or a second overlap check would be a second source of truth for the same backend rule.
 */
const DAY_FROM_SERVER: Record<string, string> = {
  MONDAY: "Mon",
  TUESDAY: "Tue",
  WEDNESDAY: "Wed",
  THURSDAY: "Thu",
  FRIDAY: "Fri",
  SATURDAY: "Sat",
  SUNDAY: "Sun",
};

export function normalizeDay(value: unknown): string | null {
  const raw = String(value ?? "");
  if (DAY_FROM_SERVER[raw]) return DAY_FROM_SERVER[raw];
  const title = raw.charAt(0).toUpperCase() + raw.slice(1, 3).toLowerCase();
  return DAY_FROM_SERVER[raw.toUpperCase()] ?? (Object.values(DAY_FROM_SERVER).includes(title) ? title : null);
}

export type AvailabilityBlock = { dayOfWeek: string; startTime: string; endTime: string };

/** `GET /availability/:id` rows → the wizard's block shape; inactive rows are not availability. */
export function availabilityFromServer(rows: unknown): AvailabilityBlock[] {
  return (Array.isArray(rows) ? rows : [])
    .filter((r: any) => r && r.isActive !== false)
    .map((r: any) => ({ dayOfWeek: normalizeDay(r.dayOfWeek) ?? "", startTime: String(r.startTime ?? ""), endTime: String(r.endTime ?? "") }))
    .filter((b) => b.dayOfWeek && b.startTime && b.endTime);
}

/**
 * A month as calendar rows, Monday-first, with nulls padding the first and last week. Returned
 * as flat cells so the grid can be a plain 7-column wrap.
 */
export function monthCells(year: number, month: number): (number | null)[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= days; d += 1) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** Day-of-month numbers in this month that have at least one session — the calendar's dots. */
export function sessionDaysIn(sessions: PtSession[], year: number, month: number): Set<number> {
  const out = new Set<number>();
  for (const s of sessions) {
    const d = new Date(s.scheduledStartAt);
    if (!Number.isNaN(d.getTime()) && d.getFullYear() === year && d.getMonth() === month) out.add(d.getDate());
  }
  return out;
}

export function sessionsOnDay(sessions: PtSession[], year: number, month: number, day: number): PtSession[] {
  return sessions
    .filter((s) => {
      const d = new Date(s.scheduledStartAt);
      return !Number.isNaN(d.getTime()) && d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
    })
    .sort((a, b) => a.scheduledStartAt.localeCompare(b.scheduledStartAt));
}

/** `YYYY-MM-DD` in local time — `toISOString()` would shift the date in UTC+7. */
export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function blockedDateSet(exceptions: unknown): Set<string> {
  const out = new Set<string>();
  for (const e of Array.isArray(exceptions) ? exceptions : []) {
    const d = new Date((e as any)?.date);
    if (!Number.isNaN(d.getTime())) out.add(isoDate(d.getFullYear(), d.getMonth(), d.getDate()));
  }
  return out;
}

export const MONTH_LABEL = (year: number, month: number) => `Tháng ${month + 1}, ${year}`;

export type SessionAction = "confirm" | "complete" | "noShow" | "cancel";

/**
 * Mirror of booking.service.ts's own guards, so a button is never offered that the server is
 * certain to refuse (web offers both regardless and lets the 400 explain):
 *  - complete   → only CONFIRMED, and only once `scheduledEndAt` has passed (P0 cluster B3).
 *  - no-show    → only CONFIRMED, and only 15 minutes past `scheduledStartAt`
 *                 (NO_SHOW_GRACE_MINUTES, P0 cluster B4 + Vòng 4/E1).
 * The grace window is the backend's default; it is configurable there, so a refusal is still
 * surfaced rather than assumed impossible.
 */
export const NO_SHOW_GRACE_MINUTES = 15;

export function sessionActions(session: PtSession, now: Date = new Date()): SessionAction[] {
  const t = now.getTime();
  const start = new Date(session.scheduledStartAt).getTime();
  const end = session.scheduledEndAt ? new Date(session.scheduledEndAt).getTime() : start + 3_600_000;
  switch (session.status) {
    case "REQUESTED":
      return ["confirm", "cancel"];
    case "CONFIRMED": {
      const out: SessionAction[] = [];
      if (Number.isFinite(end) && end <= t) out.push("complete");
      if (Number.isFinite(start) && start + NO_SHOW_GRACE_MINUTES * 60_000 <= t) out.push("noShow");
      out.push("cancel");
      return out;
    }
    default:
      return [];
  }
}

// ── Wallet (PT-05) ─────────────────────────────────────────────────────────────────────────

/**
 * PT ledger descriptions are internal English strings written by payment-service, e.g.
 * "Contract <uuid> session <uuid> — session earned". The client-side `transactionLabel` knows
 * refunds and compensation; a trainer's ledger is the other half of the same money flow
 * (earnings, pending→available releases, terminations), so it gets its own map rather than
 * stretching the client one until both are wrong.
 *
 * Two of these are internal bucket moves, not money arriving or leaving: settling a session
 * releases it from the pending bucket into the available one, which the ledger records as a
 * DEBIT of pending and a CREDIT of available. Calling that "Tiền ra khỏi ví" would read as a
 * loss, so they are named for what they are.
 */
export function ptTransactionLabel(description: string | null | undefined, entryType: string): string {
  const d = (description ?? "").toLowerCase();
  if (/session earned/.test(d)) return "Thu nhập buổi tập";
  if (/release to available/.test(d)) return "Chuyển sang số dư khả dụng";
  if (/pending released on termination/.test(d)) return "Giải phóng tiền tạm giữ";
  if (/termination — final settlement|final settlement/.test(d)) return "Tất toán hợp đồng";
  if (/pt share/.test(d)) return "Phần chia của huấn luyện viên";
  if (/admin refund/.test(d)) return "Hoàn tiền cho khách";
  if (/payment received/.test(d)) return "Học viên thanh toán";
  if (/withdraw/.test(d)) return "Rút tiền";
  // Anything left that is plainly human-written (no uuid, no SCREAMING_ENUM) can be shown as is.
  if (description && !/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(description) && !/[A-Z]{3,}_[A-Z]/.test(description)) {
    return description;
  }
  return entryType === "CREDIT" ? "Tiền vào ví" : "Tiền ra khỏi ví";
}

// ── Time formatting ────────────────────────────────────────────────────────────────────────

export function sessionTimeLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function sessionDateLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${DAY_LABELS[(d.getDay() + 6) % 7]}, ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** "Hôm nay" / "Ngày mai" beat a date a trainer has to decode mid-scroll. */
export function relativeDayLabel(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = Math.round((a - b) / 86_400_000);
  if (days === 0) return "Hôm nay";
  if (days === 1) return "Ngày mai";
  if (days === -1) return "Hôm qua";
  return sessionDateLabel(iso);
}
