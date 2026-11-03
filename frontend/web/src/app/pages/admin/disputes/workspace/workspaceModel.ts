/**
 * D2 / M2 - pure model of the Case Workspace: tabs and their URL form, the "Đang chờ" note, stuck states, the execution-blocked
 * banner, the execution tab (forward compatible: `execStatus` is not returned by any GET yet), the money tab, events, statements.
 * No React, no I/O (runs under `tsx --test`).
 *
 * Hard rules kept here:
 *  - `decision.execution` / `proposals[].execution` (a constant lie, F3) are NEVER read;
 *  - execution state is read only from `execStatus` (case or decision); absent = "Chưa đọc được trạng thái thực thi";
 *  - `ledger.result` is never read; money strings are only formatted, never added;
 *  - an internal code never becomes visible text (unknown values get a neutral Vietnamese fallback);
 *  - stuck states say WHO decides and offer no fake "close" action.
 */
import { formatMoneyString, parseCents } from "../../adminFinanceOverview.utils";
import { describeFinancialView, describeMoneyGroup, type MoneyDescription } from "../disputeFinancial";
import type { DisputeErrorView } from "../disputeCaseErrors";
import {
  CASE_STATUS_LABEL,
  EXEC_BLOCK_REASON_LABEL,
  EXEC_STATUS_LABEL,
  FINDING_CONSEQUENCE,
  FINDING_LABEL,
  OUTCOME_CONSEQUENCE,
  OUTCOME_LABEL,
} from "../disputeCaseLabels";
import {
  EXEC_STATUSES,
  type CaseStatus,
  type DisputeCaseDetail,
  type DisputeEvent,
  type DisputeEvidence,
  type DisputeFinding,
  type DisputeStatement,
  type ExecStatus,
  type FindingKind,
  type Outcome,
} from "../disputeCaseTypes";
import { asRecord, proseOrNull, shortRef } from "./format";

// ───────────────────────────────────────────────────────────────── tabs ──
export const WORKSPACE_TABS = [
  { id: "overview", label: "Tổng quan" },
  { id: "evidence", label: "Bằng chứng" },
  { id: "statements", label: "Lời khai" },
  { id: "assessments", label: "Đánh giá" },
  { id: "findings", label: "Kết luận & đề xuất" },
  { id: "approvals", label: "Phê duyệt" },
  { id: "money", label: "Tiền" },
  { id: "execution", label: "Thực thi" },
  { id: "history", label: "Lịch sử" },
] as const;
export type WorkspaceTab = (typeof WORKSPACE_TABS)[number]["id"];
export const DEFAULT_TAB: WorkspaceTab = "overview";
export const TAB_IDS: readonly string[] = WORKSPACE_TABS.map((t) => t.id);

export function parseTab(raw: string | null | undefined): WorkspaceTab {
  return TAB_IDS.includes(raw ?? "") ? (raw as WorkspaceTab) : DEFAULT_TAB;
}
/** `?tab=` value; the default tab leaves the URL clean. */
export const tabParamOf = (tab: WorkspaceTab): string | null => (tab === DEFAULT_TAB ? null : tab);
export const tabLabel = (tab: WorkspaceTab) => WORKSPACE_TABS.find((t) => t.id === tab)?.label ?? "Tổng quan";

/** A case id from the path: a plain token, else the page behaves as "not found". */
export function parseCaseIdParam(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v || v.length > 64) return null;
  return /^[A-Za-z0-9_-]+$/.test(v) ? v : null;
}

/** Small counts shown on the tabs (a number is a number, never a verdict). */
export function tabCounts(d: DisputeCaseDetail): Partial<Record<WorkspaceTab, number>> {
  return {
    evidence: d.evidence?.length ?? 0,
    statements: d.statements?.length ?? 0,
    assessments: d.assessments?.length ?? 0,
    findings: d.findings?.length ?? 0,
    approvals: (d.proposals ?? []).reduce((n, p) => n + (p.approvals?.length ?? 0), 0),
    history: d.events?.length ?? 0,
  };
}

// ──────────────────────────────────────────────────── status wording ──
export type StatusTone = "success" | "pending" | "danger" | "warning" | "info" | "neutral";
export function statusTone(status: CaseStatus | string): StatusTone {
  switch (status) {
    case "DECISION_APPROVED":
      return "success";
    case "REJECTED_INTAKE":
      return "neutral";
    case "AWAITING_APPROVAL":
    case "PROPOSED":
      return "pending";
    case "POLICY_PENDING":
      return "warning";
    default:
      return "info";
  }
}

/** "Đang chờ ..." - who/what the case waits for. Honest about what the system does NOT do. */
export const WAITING_NOTE: Record<CaseStatus, string> = {
  INTAKE: "Đang chờ: một quản trị viên nhận hồ sơ, hoặc từ chối tiếp nhận.",
  COLLECTING: "Đang chờ: điều tra viên và các bên bổ sung lời khai, bằng chứng.",
  AWAITING_PARTIES: "Đang chờ: các bên phản hồi. Các bên chưa được hệ thống tự báo và chưa có hạn trả lời.",
  ASSESSING: "Đang chờ: điều tra viên đánh giá từng khẳng định rồi ghi kết luận.",
  TECH_RECONCILIATION: "Đang chờ: đối chiếu dữ liệu kỹ thuật (chưa có thao tác riêng).",
  FINDING_RECORDED: "Đang chờ: điều tra viên lập đề xuất.",
  POLICY_PENDING: "Đang chờ: quyết định về chính sách. Ở bước này chưa có thao tác đóng hồ sơ; chỉ có thể bổ sung bằng chứng.",
  PROPOSED: "Đang chuyển sang chờ phê duyệt.",
  AWAITING_APPROVAL: "Đang chờ: một quản trị viên khác (không phải người lập đề xuất hay điều tra viên) duyệt.",
  DECISION_APPROVED: "Đã duyệt. Việc thực thi nằm ở bước riêng, xem tab Thực thi.",
  REJECTED_INTAKE: "Hồ sơ đã đóng: bị từ chối ngay từ bước tiếp nhận.",
};
export const waitingNote = (status: string) => (status in WAITING_NOTE ? WAITING_NOTE[status as CaseStatus] : "Chưa rõ hồ sơ đang chờ ai.");

export const AWAITING_PARTIES_NOTE = "Hệ thống chưa tự báo cho các bên và chưa đặt hạn trả lời; việc báo cho các bên đang làm thủ công.";

// ───────────────────────────────────────────────────────── findings ──
export function latestFinding(findings: DisputeFinding[] | null | undefined): DisputeFinding | null {
  const list = [...(findings ?? [])];
  if (list.length === 0) return null;
  return list.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? 1 : -1))[0];
}

/** finding -> allowed outcome. Illustration only: the server recomputes (the label on screen says so). */
export const FINDING_TO_OUTCOME: Record<FindingKind, Outcome | null> = {
  VERIFIED_DELIVERED: "COMPLETED",
  VERIFIED_CLIENT_ABSENT: "COMPLETED",
  VERIFIED_PT_ABSENT: "PT_NO_SHOW_CONFIRMED",
  VERIFIED_NOT_DELIVERED_NO_FAULT: "CANCELLED",
  INSUFFICIENT_EVIDENCE: null,
  NOT_A_DISPUTE: null,
};
export const FINDING_TABLE_CAPTION = "Minh hoạ, máy chủ tính lại khi lập đề xuất";
export const FINDING_TABLE_ORDER: readonly FindingKind[] = [
  "VERIFIED_DELIVERED",
  "VERIFIED_CLIENT_ABSENT",
  "VERIFIED_PT_ABSENT",
  "VERIFIED_NOT_DELIVERED_NO_FAULT",
  "INSUFFICIENT_EVIDENCE",
  "NOT_A_DISPUTE",
];
export interface FindingRow {
  finding: FindingKind;
  findingLabel: string;
  outcomeLabel: string;
  consequence: string;
}
export function findingTable(): FindingRow[] {
  return FINDING_TABLE_ORDER.map((f) => {
    const o = FINDING_TO_OUTCOME[f];
    return {
      finding: f,
      findingLabel: FINDING_LABEL[f],
      outcomeLabel: o ? OUTCOME_LABEL[o] : "Chưa có kết quả",
      consequence: FINDING_CONSEQUENCE[f],
    };
  });
}
export const outcomeConsequence = (o: string | null | undefined) => (o && o in OUTCOME_CONSEQUENCE ? OUTCOME_CONSEQUENCE[o as Outcome] : "Hệ quả chưa rõ.");

// ───────────────────────────────────────────── stuck states & banner ──
export interface StuckState {
  title: string;
  body: string;
  /** who owns the next move */
  owner: string;
}
/**
 * Cases that have no exit in the UI. They say who decides; they never carry a "close" button.
 * `AWAITING_PARTIES` is not stuck but must say the parties are not notified (R-12).
 */
export function stuckState(d: DisputeCaseDetail): StuckState | null {
  const status = d.case?.status;
  if (status === "POLICY_PENDING") {
    return {
      title: "Hồ sơ đang chờ quyết định về chính sách",
      body: "Kết luận hiện tại chưa cho phép lập đề xuất. Hệ thống chưa có thao tác đóng hồ sơ ở bước này; điều tra viên chỉ có thể quay lại bổ sung bằng chứng hoặc đánh giá lại.",
      owner: "Người quyết định: chủ dự án (chưa có chính sách).",
    };
  }
  if (status === "FINDING_RECORDED" && latestFinding(d.findings)?.finding === "NOT_A_DISPUTE") {
    return {
      title: "Kết luận «Không phải khiếu nại» chưa có cách xử lý",
      body: "Hệ thống chưa có thiết kế xử lý cho trường hợp này nên chưa lập được đề xuất, và cũng chưa có thao tác đóng hồ sơ.",
      owner: "Người quyết định: chủ dự án.",
    };
  }
  if (status === "DECISION_APPROVED") {
    return {
      title: "Quyết định đã được duyệt",
      body: "Hồ sơ không còn bước nào ở phía điều tra. Việc thực thi nằm ở bước riêng; màn này chỉ hiển thị trạng thái thực thi khi máy chủ trả về (xem tab Thực thi).",
      owner: "Người quyết định: bộ thực thi và đội kỹ thuật, không phải điều tra viên.",
    };
  }
  return null;
}

export const BLOCKED_BANNER_APPROVED = "Quyết định đã được duyệt nhưng chưa thực thi được vì buổi có khoản đền đến muộn chưa được xử lý.";
export const BLOCKED_BANNER_PROPOSED = "Quyết định sẽ được duyệt nhưng chưa thực thi được vì buổi có khoản đền đến muộn chưa được xử lý.";
export const BLOCKED_BANNER_UNKNOWN = "Quyết định chưa thực thi được. Lý do chưa rõ.";

/** Wording of ONE blocked reason (proposal or decision). Unknown reason -> neutral sentence, never the code. */
export function blockedText(reason: string | null | undefined, approved: boolean): string | null {
  if (!reason) return null;
  if (reason === "D77_COMBINATION_UNRESOLVED") return approved ? BLOCKED_BANNER_APPROVED : BLOCKED_BANNER_PROPOSED;
  return BLOCKED_BANNER_UNKNOWN;
}

/** Business wording of `decision.executionBlockedReason` (or the open proposal's). Never the raw code. */
export function blockedBanner(d: DisputeCaseDetail): string | null {
  const decisionReason = d.decision?.executionBlockedReason ?? null;
  if (decisionReason) return blockedText(decisionReason, true);
  if (d.case?.status === "AWAITING_APPROVAL" || d.case?.status === "PROPOSED") {
    const open = [...(d.proposals ?? [])].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    if (open?.executionBlockedReason) return blockedText(open.executionBlockedReason, false);
  }
  return null;
}

// ───────────────────────────────────────────────────────── execution ──
export const EXEC_UNREADABLE_HEADLINE = "Chưa đọc được trạng thái thực thi";
export const EXEC_UNREADABLE_HELP = "Máy chủ chưa trả trường này nên màn hình không suy đoán. Không dùng trường «thực thi» cũ của quyết định vì giá trị đó không đổi kể cả sau khi đã thực thi.";
/** Said from `status = DECISION_APPROVED` alone: it states only what is known (approved) and that the execution state could not be read. */
export const EXEC_APPROVED_NOT_EXECUTED = "Đã duyệt. Chưa đọc được trạng thái thực thi.";

export const EXEC_TABLE: Array<{ status: ExecStatus; meaning: string; next: string }> = [
  { status: "NOT_STARTED", meaning: "Đã duyệt, chưa thực thi.", next: "Chờ thực thi." },
  { status: "EXECUTING", meaning: "Đang thực thi, hoặc lần trước chưa kết thúc.", next: "Nếu quá lâu, cần đối soát thực thi (sau ít nhất khoảng 1 phút)." },
  { status: "EXEC_BLOCKED", meaning: "Chưa thực thi được vì một điều kiện chưa đạt.", next: "Thử lại khi nguyên nhân đã hết." },
  { status: "BUSINESS_DONE", meaning: "Phần nghiệp vụ đã được thực thi. Chưa có nghĩa là tiền đã về.", next: "Xem tab Tiền để biết tiền." },
  { status: "NEEDS_HUMAN", meaning: "Cần người xem xét. Hệ thống không tự thử lại.", next: "Chưa có thao tác thoát trên giao diện; cần can thiệp kỹ thuật." },
];

export interface ExecView {
  /** false = the server returned no execution state */
  readable: boolean;
  status: ExecStatus | null;
  headline: string;
  lines: string[];
  /** the five-state reference table is shown only when the state is readable */
  showTable: boolean;
}

function readExecStatus(d: DisputeCaseDetail): { status: ExecStatus | null; reason: string | null } {
  const c = asRecord(d.case) ?? {};
  const dec = asRecord(d.decision) ?? {};
  const raw = typeof c.execStatus === "string" ? c.execStatus : typeof dec.execStatus === "string" ? dec.execStatus : null;
  const status = raw && (EXEC_STATUSES as readonly string[]).includes(raw) ? (raw as ExecStatus) : null;
  const reason = typeof c.execBlockReason === "string" ? c.execBlockReason : typeof dec.execBlockReason === "string" ? dec.execBlockReason : null;
  return { status, reason };
}

/** NEVER derives anything from `decision.execution`. */
export function describeExecution(d: DisputeCaseDetail): ExecView {
  const { status, reason } = readExecStatus(d);
  if (!status) {
    const lines = [EXEC_UNREADABLE_HELP];
    if (d.case?.status === "DECISION_APPROVED") lines.unshift(EXEC_APPROVED_NOT_EXECUTED);
    return { readable: false, status: null, headline: EXEC_UNREADABLE_HEADLINE, lines, showTable: false };
  }
  const lines: string[] = [];
  if (status === "EXEC_BLOCKED") {
    lines.push(reason && reason in EXEC_BLOCK_REASON_LABEL ? EXEC_BLOCK_REASON_LABEL[reason as keyof typeof EXEC_BLOCK_REASON_LABEL] : "Lý do chưa rõ.");
  }
  if (status === "BUSINESS_DONE") lines.push("Đã thực thi phần nghiệp vụ. Đây không phải xác nhận tiền đã về; xem tab Tiền.");
  if (status === "NEEDS_HUMAN") lines.push("Cần người xem xét. Hệ thống không tự thử lại và chưa có thao tác thoát trên giao diện.");
  if (status === "EXECUTING") lines.push("Nếu trạng thái này kéo dài, cần đối soát thực thi.");
  return { readable: true, status, headline: EXEC_STATUS_LABEL[status], lines, showTable: true };
}

// ─────────────────────────────────────────────────────────── money ──
export const MONEY_STEP_TITLE: Record<string, string> = {
  SESSION_RELEASE: "Nhả tiền buổi tập",
  PT_NO_SHOW: "Hoàn tiền do PT vắng",
  PT_LATE_ARRIVAL: "Khoản đền do PT đến muộn",
  UNRESOLVED_SESSION: "Giải quyết buổi bị giữ",
};
export function moneyStepTitle(key: string | null | undefined): string {
  const prefix = typeof key === "string" ? key.split(":")[0] : "";
  return MONEY_STEP_TITLE[prefix] ?? "Bước tiền khác";
}

export interface MoneyAmount {
  label: string;
  value: string;
}
export interface MoneyItemView {
  key: string;
  title: string;
  description: MoneyDescription;
  /** amounts straight from `ledger.obligation` strings, formatted only */
  amounts: MoneyAmount[];
  unavailable: boolean;
  unavailableText: string | null;
  /** RESOLVED_OTHER: the lookup carries no reason (R-13) */
  reasonElsewhere: boolean;
}
export interface MoneyView {
  group: MoneyDescription;
  noRecordedSettlement: boolean;
  unavailableGroup: boolean;
  observedAt: string | null;
  items: MoneyItemView[];
}

/** states whose obligation numbers are meaningful on their own; for the others the D1 sentence already carries the right amount */
const SHOW_AMOUNTS: readonly string[] = ["LEDGER_POSTED_PARTIAL", "OBLIGATION_IN_PAYMENT", "OBLIGATION_PAID_VERIFIED", "OBLIGATION_PAID_VIA_LEDGER"];

function amountOf(v: unknown): string | null {
  return parseCents(v) === null ? null : formatMoneyString(v);
}

export function describeMoneyTab(d: DisputeCaseDetail): MoneyView | null {
  const fin = d.financial;
  const described = describeFinancialView(fin);
  if (!fin || !described) return null;
  const items: MoneyItemView[] = (fin.items ?? []).map((item, i) => {
    const description = described.items[i];
    const ledger = item.ledger;
    const amounts: MoneyAmount[] = [];
    if (ledger && ledger.status === "FOUND" && ledger.obligation && SHOW_AMOUNTS.includes(item.state)) {
      const owed = amountOf(ledger.obligation.owed);
      const paid = amountOf(ledger.obligation.paid);
      const unpaid = amountOf(ledger.obligation.unpaid);
      if (owed) amounts.push({ label: "Nghĩa vụ", value: owed });
      if (paid) amounts.push({ label: "Đã ghi sổ", value: paid });
      if (unpaid) amounts.push({ label: "Còn lại", value: unpaid });
    }
    const unavailable = item.state === "UNAVAILABLE" || ledger?.status === "UNAVAILABLE";
    return {
      key: item.key,
      title: moneyStepTitle(item.key),
      description,
      amounts,
      unavailable,
      unavailableText: unavailable ? "Chưa đọc được sổ cái, nên chưa biết bước này đã ghi bao nhiêu. Đây không phải 0 đ." : null,
      reasonElsewhere: item.state === "OBLIGATION_RESOLVED_OTHER",
    };
  });
  return {
    group: describeMoneyGroup(fin),
    noRecordedSettlement: fin.group === "NO_RECORDED_SETTLEMENT",
    unavailableGroup: fin.group === "UNAVAILABLE" || items.some((i) => i.unavailable),
    observedAt: typeof fin.observedAt === "string" ? fin.observedAt : null,
    items,
  };
}
export const NO_SETTLEMENT_TEXT =
  "Buổi này chưa có bước quyết toán tiền nào được ghi nhận. Điều này khác với «không phát sinh tiền»: có thể bước tiền chưa được tạo.";

// ──────────────────────────────────────────────────────────── events ──
export const EVENT_LABEL: Record<string, string> = {
  INTAKE: "Mở hồ sơ",
  ASSIGN: "Giao người phụ trách",
  RECOLLECT: "Thu lại bằng chứng",
  TRANSITION: "Chuyển bước",
  REQUEST_MORE: "Yêu cầu bổ sung",
  CLASSIFIED: "Phân loại hồ sơ",
  CLAIM_ADDED: "Thêm khẳng định",
  ISSUE_RECORDED: "Ghi nhận vấn đề PT đến muộn",
  ASSESSMENT_RECORDED: "Ghi đánh giá",
  FINDING_RECORDED: "Ghi kết luận",
  PROPOSAL_CREATED: "Lập đề xuất",
  EVIDENCE_CHANGE_ACK: "Xác nhận thay đổi bằng chứng",
  POLICY_ELIGIBILITY_PROPOSED: "Đề xuất kết luận áp dụng chính sách",
  POLICY_ELIGIBILITY_APPROVED: "Duyệt kết luận áp dụng chính sách",
  DECISION_APPROVED: "Duyệt quyết định",
  DECISION_REJECTED: "Bác đề xuất",
  SHARED: "Chia sẻ cho một bên",
  STATEMENT_SUBMITTED: "Bên liên quan nộp lời khai",
  EVIDENCE_SUBMITTED: "Bên liên quan nộp bằng chứng",
  EVIDENCE_FILE_SUBMITTED: "Bên liên quan nộp tệp",
  EXECUTION_STARTED: "Bắt đầu thực thi",
  EXECUTION_BLOCKED: "Thực thi bị chặn",
  EXECUTION_NEEDS_HUMAN: "Thực thi cần người xem xét",
  EXECUTION_BUSINESS_DONE: "Thực thi xong phần nghiệp vụ",
};
export const eventLabel = (action: string | null | undefined) => (action && action in EVENT_LABEL ? EVENT_LABEL[action] : "Thao tác khác");

const ACTOR_ROLE_LABEL: Record<string, string> = { ADMIN: "Quản trị viên", CLIENT: "Khách", PT: "PT", SYSTEM: "Hệ thống" };
export function eventActor(e: Pick<DisputeEvent, "actorUserId" | "actorRole">, currentUserId: string | null | undefined): string {
  if (currentUserId && e.actorUserId === currentUserId) return "Bạn";
  const role = ACTOR_ROLE_LABEL[e.actorRole] ?? "Người dùng";
  return e.actorUserId ? `${role} (mã ${shortRef(e.actorUserId)})` : role;
}
/** A note typed by a person; codes like CONTRACT_ENDING are mapped, anything else code-like is dropped. */
export function eventNote(e: Pick<DisputeEvent, "note">): string | null {
  if (!e.note) return null;
  if (e.note in EXEC_BLOCK_REASON_LABEL) return EXEC_BLOCK_REASON_LABEL[e.note as keyof typeof EXEC_BLOCK_REASON_LABEL];
  return proseOrNull(e.note);
}
export function eventStep(e: Pick<DisputeEvent, "fromStatus" | "toStatus">): string | null {
  const f = e.fromStatus ? CASE_STATUS_LABEL[e.fromStatus] : null;
  const t = e.toStatus ? CASE_STATUS_LABEL[e.toStatus] : null;
  if (f && t && e.fromStatus !== e.toStatus) return `${f} → ${t}`;
  if (t && !f) return t;
  return null;
}
export function sortedEvents(events: DisputeEvent[] | null | undefined): DisputeEvent[] {
  return [...(events ?? [])].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? 1 : -1));
}
export const HISTORY_LIMIT_NOTE = "Tối đa 200 sự kiện gần nhất. Máy chủ chưa trả nội dung chi tiết của từng sự kiện.";

// ─────────────────────────────────────────────────────── statements ──
export interface StatementThread {
  partyRole: string;
  /** newest version first */
  versions: DisputeStatement[];
}
export function statementThreads(statements: DisputeStatement[] | null | undefined): StatementThread[] {
  const by = new Map<string, DisputeStatement[]>();
  for (const s of statements ?? []) by.set(s.partyRole, [...(by.get(s.partyRole) ?? []), s]);
  const order = ["CLIENT", "PT", "ADMIN_ON_BEHALF"];
  return [...by.entries()]
    .sort((a, b) => (order.indexOf(a[0]) === -1 ? 9 : order.indexOf(a[0])) - (order.indexOf(b[0]) === -1 ? 9 : order.indexOf(b[0])))
    .map(([partyRole, versions]) => ({ partyRole, versions: versions.sort((a, b) => b.version - a.version) }));
}
export const statementSourceText = (s: Pick<DisputeStatement, "source" | "version">) =>
  s.source === "LEGACY_FIELD" ? "Lấy từ trường cũ của buổi tập (phiên bản 1)" : `Nộp qua hệ thống (phiên bản ${s.version})`;

// ───────────────────────────────────────────────────────── load errors ──
export type LoadFailureKind = "notFound" | "forbidden" | "auth" | "conflict" | "network" | "other";
export interface LoadFailure {
  kind: LoadFailureKind;
  title: string;
  body: string;
  /** "Tải lại hồ sơ" button */
  canReload: boolean;
  /** link back to the queue */
  backToQueue: boolean;
}

/** A failed LOAD is never an empty case: every kind says what happened and what to do. */
export function describeLoadFailure(view: DisputeErrorView): LoadFailure {
  switch (view.kind) {
    case "notFound":
      return { kind: "notFound", title: "Không tìm thấy hồ sơ", body: "Hồ sơ này không tồn tại hoặc đường dẫn không đúng. Quay lại danh sách để chọn lại.", canReload: false, backToQueue: true };
    case "forbidden":
      return { kind: "forbidden", title: "Không có quyền xem hồ sơ", body: "Tài khoản này không có quyền xem hồ sơ khiếu nại.", canReload: false, backToQueue: true };
    case "auth":
      return { kind: "auth", title: "Phiên đăng nhập đã hết hạn", body: view.message, canReload: false, backToQueue: false };
    case "conflictReload":
      return { kind: "conflict", title: "Hồ sơ vừa được cập nhật", body: view.message, canReload: true, backToQueue: false };
    case "network":
      return { kind: "network", title: "Mất kết nối", body: `${view.message} Đây không phải là hồ sơ trống.`, canReload: true, backToQueue: false };
    default:
      return { kind: "other", title: "Không tải được hồ sơ", body: `${view.message} Đây không phải là hồ sơ trống.`, canReload: true, backToQueue: false };
  }
}

// ────────────────────────────────────────────────────────── helpers ──
/** Finds the latest row of a subject (e.g. SESSION_ROW), version-aware. */
export function latestEvidenceOfSubject(evidence: DisputeEvidence[] | null | undefined, subject: string): DisputeEvidence | null {
  const rows = (evidence ?? []).filter((e) => e.subject === subject);
  if (rows.length === 0) return null;
  return rows.sort((a, b) => b.snapshotVersion - a.snapshotVersion || Date.parse(b.capturedAt) - Date.parse(a.capturedAt))[0];
}
