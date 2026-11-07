/**
 * D2 / M1 - pure model of the dispute queue: URL state, the "Buổi chưa xử lý" rows (C1) joined with the SLA of the
 * reconciliation report (C2), and the wording of the legacy ruling. No React, no I/O (runs under `tsx --test`).
 *
 * Honesty rules kept here:
 *  - there is NO "escalated" view (the server flag is never written);
 *  - SLA missing for a session = no chip at all, never a guessed "trong hạn";
 *  - a row that cannot be read is counted in `ignored`, not silently dropped.
 */
import { CASE_STATUSES, type CaseStatus, type CaseType, type QueueItem, type SlaState } from "../disputeCaseTypes";
import { parseDisputeError, type DisputeErrorView } from "../disputeCaseErrors";
import type { LoadFailure } from "../workspace/workspaceModel";
import { CASE_TYPE_LABEL, FINDING_CONSEQUENCE, OUTCOME_CONSEQUENCE } from "../disputeCaseLabels";
import { asArray, asRecord, shortRef } from "../workspace/format";

// ───────────────────────────────────────────────────────────── URL state ──
export const QUEUE_VIEWS = ["cases", "sessions", "stuck"] as const;
export type QueueView = (typeof QUEUE_VIEWS)[number];
export const DEFAULT_QUEUE_VIEW: QueueView = "cases";
export const PAGE_SIZE = 50;
/** offset is capped at 100000 by the server (A2) */
export const MAX_PAGE = Math.floor(100_000 / PAGE_SIZE) + 1;

export interface QueueState {
  view: QueueView;
  /** null = every status */
  status: CaseStatus | null;
  /** 1-based */
  page: number;
}

export function parseView(raw: string | null | undefined): QueueView {
  return (QUEUE_VIEWS as readonly string[]).includes(raw ?? "") ? (raw as QueueView) : DEFAULT_QUEUE_VIEW;
}
export function parseStatus(raw: string | null | undefined): CaseStatus | null {
  return (CASE_STATUSES as readonly string[]).includes(raw ?? "") ? (raw as CaseStatus) : null;
}
export function parsePage(raw: string | null | undefined): number {
  if (!raw || !/^\d{1,5}$/.test(raw)) return 1;
  const n = Number(raw);
  return n >= 1 && n <= MAX_PAGE ? n : 1;
}

/** Total: a stale or hostile link opens the first page of the default view. */
export function parseQueueState(params: { get(name: string): string | null }): QueueState {
  const view = parseView(params.get("view"));
  return {
    view,
    status: view === "cases" ? parseStatus(params.get("status")) : null,
    page: view === "cases" ? parsePage(params.get("page")) : 1,
  };
}

/** Defaults are omitted so the plain URL stays `/admin/disputes`. `status` / `page` only exist in the cases view. */
export function buildQueueParams(s: Partial<QueueState>): Record<string, string> {
  const out: Record<string, string> = {};
  const view = s.view ?? DEFAULT_QUEUE_VIEW;
  if (view !== DEFAULT_QUEUE_VIEW) out.view = view;
  if (view === "cases") {
    if (s.status) out.status = s.status;
    if (s.page && s.page > 1) out.page = String(s.page);
  }
  return out;
}

export const offsetOfPage = (page: number) => (Math.max(1, page) - 1) * PAGE_SIZE;
export const pageCountOf = (total: number) => Math.max(1, Math.ceil(Math.max(0, total) / PAGE_SIZE));
/** "1–50 trên 120" ; null when there is nothing to show */
export function rangeText(page: number, total: number, shown: number): string | null {
  if (total <= 0 || shown <= 0) return null;
  const from = offsetOfPage(page) + 1;
  return `${from}–${from + shown - 1} trên ${total}`;
}

// ───────────────────────────────────────────────────────────── cases (A2) ──
export function investigatorText(investigatorId: string | null | undefined, currentUserId: string | null | undefined): string {
  if (!investigatorId) return "Chưa có người phụ trách";
  if (currentUserId && investigatorId === currentUserId) return "Bạn phụ trách";
  return `Người phụ trách: mã ${shortRef(investigatorId)}`;
}
export const isProvisionalType = (type: CaseType | string) => type === "LEGACY_UNCLASSIFIED";
/** Type column text: the provisional type is shown as a chip, so the text just says it has no class yet. */
export function typeColumnText(type: CaseType | string): string {
  if (isProvisionalType(type)) return "Chưa phân loại";
  return type in CASE_TYPE_LABEL ? CASE_TYPE_LABEL[type as CaseType] : "Loại khiếu nại khác";
}

/** Age of a case = time since it was opened. */
export function normalizeCaseItems(data: unknown): { total: number; items: Array<Record<string, any>>; ignored: number } {
  const root = asRecord(data);
  const raw = asArray(root?.items);
  const items = raw.map((r) => asRecord(r)).filter((r): r is Record<string, any> => !!r && typeof r.id === "string" && r.id.length > 0 && typeof r.status === "string");
  const total = typeof root?.total === "number" && Number.isFinite(root.total) ? Math.max(0, Math.floor(root.total)) : items.length;
  return { total, items, ignored: raw.length - items.length };
}

// ──────────────────────────────────────────────────── sessions (C1 + C2) ──
export const SLA_LABEL: Record<SlaState, string> = {
  WITHIN_SLA: "Trong hạn xử lý",
  DUE_SOON: "Sắp quá hạn xử lý",
  OVERDUE: "Quá hạn xử lý",
};
export type SlaTone = "success" | "warning" | "danger";
export const SLA_TONE: Record<SlaState, SlaTone> = { WITHIN_SLA: "success", DUE_SOON: "warning", OVERDUE: "danger" };

/** Session `disputeType` (legacy column) -> the case type it would open as. */
const SESSION_DISPUTE_TO_CASE_TYPE: Record<string, CaseType> = {
  DELIVERY_DISPUTE: "PT_DELIVERY",
  PT_NO_SHOW_CLAIM: "PT_NO_SHOW_CLAIM",
  CLIENT_NO_SHOW_CLAIM: "PT_CLIENT_NO_SHOW_CLAIM",
};
export function sessionTypeLabel(disputeType: string | null | undefined): string {
  const t = disputeType ? SESSION_DISPUTE_TO_CASE_TYPE[disputeType] : undefined;
  return t ? CASE_TYPE_LABEL[t] : "Phân loại tạm (cần phân loại)";
}

export interface SessionRowModel {
  id: string;
  scheduledStartAt: string | null;
  disputedAt: string | null;
  disputeType: string | null;
  typeLabel: string;
  /** what the client said (free text of a user) */
  clientReason: string;
  /** what the PT said */
  ptNotes: string;
  packageName: string | null;
  clientRef: string;
  ptRef: string;
  sla: SlaState | null;
  sessionStatus?: "DISPUTED" | "PT_NO_SHOW_REPORTED";
  clientName?: string | null;
  ptName?: string | null;
  hasCase?: boolean;
  needsCase?: boolean;
  caseId?: string | null;
  contractId?: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

export function normalizeDisputedSessions(data: unknown): { rows: SessionRowModel[]; ignored: number } {
  const raw = Array.isArray(data) ? data : [];
  const rows: SessionRowModel[] = [];
  for (const r of raw) {
    const o = asRecord(r);
    if (!o || typeof o.id !== "string" || !o.id) continue;
    const contract = asRecord(o.contract);
    rows.push({
      id: o.id,
      scheduledStartAt: str(o.scheduledStartAt),
      disputedAt: str(o.disputedAt),
      disputeType: str(o.disputeType),
      typeLabel: sessionTypeLabel(str(o.disputeType)),
      clientReason: str(o.disputeReason) ?? "",
      ptNotes: str(o.ptNotes) ?? "",
      packageName: str(contract?.packageName),
      clientRef: shortRef(str(o.clientUserId)),
      ptRef: shortRef(str(o.ptUserId)),
      sla: null,
      contractId: str(o.contractId) ?? str(contract?.id),
    });
  }
  // oldest dispute first (the server already sorts so; keep it if a fixture does not)
  rows.sort((a, b) => (Date.parse(a.disputedAt ?? "") || Infinity) - (Date.parse(b.disputedAt ?? "") || Infinity));
  return { rows, ignored: raw.length - rows.length };
}

/** A3 is the authoritative paged queue. It covers both dispute states and tells the UI whether a Case already owns a session. */
export function normalizeQueueItems(data: unknown): { rows: SessionRowModel[]; total: number; hasMore: boolean; ignored: number } {
  const root = asRecord(data);
  const raw = asArray(root?.items);
  const rows: SessionRowModel[] = [];
  for (const item of raw) {
    const r = asRecord(item) as unknown as QueueItem | null;
    if (!r || typeof r.sessionId !== "string" || !r.sessionId || !["DISPUTED", "PT_NO_SHOW_REPORTED"].includes(r.sessionStatus)) continue;
    rows.push({
      id: r.sessionId,
      scheduledStartAt: str(r.scheduledStartAt),
      disputedAt: str(r.disputedAt),
      disputeType: str(r.disputeType),
      typeLabel: r.sessionStatus === "PT_NO_SHOW_REPORTED" ? "Khách báo PT vắng, đang chờ PT phản hồi" : sessionTypeLabel(r.disputeType),
      clientReason: "",
      ptNotes: "",
      packageName: null,
      clientRef: shortRef(r.clientUserId),
      ptRef: shortRef(r.ptUserId),
      sla: null,
      sessionStatus: r.sessionStatus,
      clientName: str(r.clientName),
      ptName: str(r.ptName),
      hasCase: r.hasCase === true,
      needsCase: r.needsCase === true,
      caseId: str(r.caseId),
      contractId: str(r.contractId),
    });
  }
  return {
    rows,
    total: typeof root?.total === "number" ? Math.max(0, root.total) : rows.length,
    hasMore: root?.hasMore === true,
    ignored: raw.length - rows.length,
  };
}

export interface SlaIndex {
  bySession: Map<string, SlaState>;
  /** The report cut the list short: a missing session may simply not have fitted. */
  truncated: boolean;
}

const SLA_STATES: readonly string[] = ["WITHIN_SLA", "DUE_SOON", "OVERDUE"];

/** C2 `disputes.items` -> sessionId -> SLA state. null = the report could not be read (no chips at all). */
export function buildSlaIndex(report: unknown): SlaIndex | null {
  const disputes = asRecord(asRecord(report)?.disputes);
  if (!disputes || !Array.isArray(disputes.items)) return null;
  const bySession = new Map<string, SlaState>();
  for (const it of disputes.items) {
    const o = asRecord(it);
    if (!o || typeof o.sessionId !== "string") continue;
    if (typeof o.slaState === "string" && SLA_STATES.includes(o.slaState)) bySession.set(o.sessionId, o.slaState as SlaState);
  }
  return { bySession, truncated: disputes.truncated === true };
}

/** SLA missing -> `sla: null` (no chip). Never a default. */
export function joinSla(rows: SessionRowModel[], index: SlaIndex | null): SessionRowModel[] {
  if (!index) return rows;
  return rows.map((r) => ({ ...r, sla: index.bySession.get(r.id) ?? null }));
}

// ──────────────────────────────────────────────── open case (A1) results ──
export interface OpenCaseOutcome {
  /** where to go */
  caseId: string;
  /** false = the session already had an open case: not an error */
  created: boolean;
}
export function readOpenCaseResult(data: unknown): OpenCaseOutcome | null {
  const o = asRecord(data);
  const c = asRecord(o?.case);
  if (!o || !c || typeof c.id !== "string" || !c.id) return null;
  return { caseId: c.id, created: o.created !== false };
}

// ─────────────────────────────────────────────────────── legacy ruling ──
export type LegacyResolution = "COMPLETED" | "PT_NO_SHOW_CONFIRMED" | "CANCELLED";
export const LEGACY_RESOLUTIONS: readonly LegacyResolution[] = ["COMPLETED", "PT_NO_SHOW_CONFIRMED", "CANCELLED"];

export const LEGACY_DISCLOSURE_LABEL = "Phán quyết theo đường cũ (một người duyệt, không qua hồ sơ)";
export const LEGACY_WARNING =
  "Đường này chỉ cần một quản trị viên xác nhận, không có bước duyệt thứ hai, và không đọc hồ sơ khiếu nại của buổi." +
  " Buổi đã có hồ sơ phải được xử lý trong hồ sơ; không thể dùng đường này.";
export const LEGACY_BUTTON_LABEL: Record<LegacyResolution, string> = {
  COMPLETED: "Buổi tập đã diễn ra",
  PT_NO_SHOW_CONFIRMED: "Xác nhận PT vắng mặt",
  CANCELLED: "Buổi tập không diễn ra",
};
export const LEGACY_DIALOG_TITLE: Record<LegacyResolution, string> = {
  COMPLETED: "Kết luận: buổi tập đã diễn ra",
  PT_NO_SHOW_CONFIRMED: "Kết luận: PT vắng mặt",
  CANCELLED: "Kết luận: buổi tập không diễn ra",
};
/** Same wording as the case workspace (DQ-2(a)): PT absent = refund AND the session right is still used. Never "buổi tập không bị trừ" for it. */
export const LEGACY_CONSEQUENCE: Record<LegacyResolution, string> = {
  COMPLETED: OUTCOME_CONSEQUENCE.COMPLETED,
  PT_NO_SHOW_CONFIRMED: FINDING_CONSEQUENCE.VERIFIED_PT_ABSENT,
  CANCELLED: OUTCOME_CONSEQUENCE.CANCELLED,
};
export const LEGACY_EFFECTS_COMMON = [
  "Kết luận được ghi ngay sau khi bạn xác nhận. Không có bước duyệt thứ hai và không hoàn tác được.",
  "Số tiền do hệ thống tự tính theo hợp đồng; màn này không cho nhập số tiền.",
];
export const LEGACY_NOTICE =
  "Đây là đường cũ. Hợp đồng chưa có kết luận áp dụng chính sách thì hệ thống sẽ từ chối và chưa ghi gì.";

export function legacyEffects(resolution: LegacyResolution): string[] {
  return [LEGACY_CONSEQUENCE[resolution], ...LEGACY_EFFECTS_COMMON];
}

/** Notes shown on the queue (muted). */
export const CASES_NOTE_NO_POLLING = "Danh sách không tự làm mới: mỗi lần mở danh sách, hệ thống ghi nhật ký truy cập của từng hồ sơ.";
export const SESSIONS_NOTE_OPEN_EXISTING = "Nếu buổi đã có hồ sơ đang mở, hệ thống đưa bạn vào hồ sơ đó.";
export const STUCK_NOTE = "Hồ sơ bị nghẽn quy trình hoặc cần quản trị viên can thiệp trực tiếp để tiếp tục.";

export const STUCK_KINDS = ["POLICY_PENDING", "NEEDS_HUMAN", "EXEC_BLOCKED"] as const;
export type StuckKind = (typeof STUCK_KINDS)[number];

export const STUCK_KIND_LABEL: Record<string, string> = {
  POLICY_PENDING: "Chờ chốt chính sách",
  NEEDS_HUMAN: "Cần người xem xét",
  EXEC_BLOCKED: "Thực thi bị nghẽn",
};

export function stuckKindLabel(kind: string | null | undefined): string {
  if (kind && kind in STUCK_KIND_LABEL) return STUCK_KIND_LABEL[kind];
  return kind ?? "Cần xử lý";
}

export function stuckKindTone(kind: string | null | undefined): "warning" | "danger" | "info" {
  switch (kind) {
    case "POLICY_PENDING":
      return "warning";
    case "NEEDS_HUMAN":
    case "EXEC_BLOCKED":
      return "danger";
    default:
      return "info";
  }
}

/**
 * MoneyActionDialog maps errors with its own mapper (`describeAdminError`), which knows none of the dispute codes. So the legacy
 * ruling hands it an error it can read: the dispute wording as the server-style Vietnamese `error`, status 409 for a refusal
 * (the dialog then blocks a blind retry and offers a reload) or 400 for the rest. No answer / unknown outcome: the original error
 * is passed through so the dialog says "chưa biết đã ghi hay chưa".
 */
export function toDialogError(error: unknown): unknown {
  const view = parseDisputeError(error, { action: "write" });
  if (view.status === null || view.outcomeUnknown || view.kind === "network") return error;
  const status = view.kind === "blocked" || view.kind === "conflictReload" ? 409 : 400;
  return { response: { status, data: { error: view.message } } };
}

/** A failed LIST read is never "no cases". */
export function describeListFailure(view: DisputeErrorView, what: "cases" | "sessions" | "stuck"): LoadFailure {
  const subject =
    what === "cases"
      ? "danh sách hồ sơ"
      : what === "sessions"
        ? "danh sách buổi chưa xử lý"
        : "danh sách hồ sơ cần người xử lý";
  const empty =
    what === "cases"
      ? "không có hồ sơ nào"
      : what === "sessions"
        ? "không có buổi nào"
        : "không có hồ sơ bị nghẽn nào";
  if (view.kind === "forbidden") return { kind: "forbidden", title: "Không có quyền xem", body: `Tài khoản này không có quyền xem ${subject}.`, canReload: false, backToQueue: false };
  if (view.kind === "auth") return { kind: "auth", title: "Phiên đăng nhập đã hết hạn", body: view.message, canReload: false, backToQueue: false };
  return {
    kind: view.kind === "network" ? "network" : "other",
    title: view.kind === "network" ? "Mất kết nối" : `Không tải được ${subject}`,
    body: `${view.message} Đây không phải là «${empty}»: hãy thử lại trước khi kết luận.`,
    canReload: true,
    backToQueue: false,
  };
}
