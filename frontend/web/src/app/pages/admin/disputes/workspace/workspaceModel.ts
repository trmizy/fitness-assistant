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
  CASE_TYPE_LABEL,
  CLOSE_REASON_NOTE,
  EXEC_BLOCK_REASON_LABEL,
  EXEC_STATUS_LABEL,
  FINDING_CONSEQUENCE,
  FINDING_LABEL,
  OUTCOME_CONSEQUENCE,
  OUTCOME_LABEL,
  POLICY_RESULT_LABEL,
} from "../disputeCaseLabels";
import {
  EXEC_STATUSES,
  type CaseStatus,
  type CaseType,
  type CloseReason,
  type DisputeCaseDetail,
  type DisputeEvent,
  type DisputeEvidence,
  type DisputeFinding,
  type DisputeStatement,
  type ExecStatus,
  type ExecutionHistoryItem,
  type PolicyResult,
  type FindingKind,
  type Outcome,
} from "../disputeCaseTypes";
import { asRecord, looksLikeInternalCode, proseOrNull, shortRef } from "./format";

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
  AWAITING_PARTIES: "Đang chờ: các bên phản hồi. Hệ thống đã báo cho các bên trong ứng dụng; chưa có hạn trả lời.",
  ASSESSING: "Đang chờ: điều tra viên đánh giá từng khẳng định rồi ghi kết luận.",
  TECH_RECONCILIATION: "Đang chờ: đối chiếu dữ liệu kỹ thuật (chưa có thao tác riêng).",
  FINDING_RECORDED: "Đang chờ: điều tra viên lập đề xuất.",
  POLICY_PENDING: "Đang chờ: quyết định về chính sách. Ở bước này chưa có thao tác đóng hồ sơ; chỉ có thể bổ sung bằng chứng.",
  PROPOSED: "Đang chuyển sang chờ phê duyệt.",
  AWAITING_APPROVAL: "Đang chờ: một quản trị viên khác (không phải người lập đề xuất hay điều tra viên) duyệt.",
  DECISION_APPROVED: "Đã duyệt. Việc thực thi nằm ở bước riêng, xem tab Thực thi.",
  REJECTED_INTAKE: "Hồ sơ đã đóng, không có quyết định nào về buổi tập hay tiền.",
  CLOSED: "Hồ sơ đã đóng. Việc đóng không chuyển tiền và không đổi buổi tập; trạng thái tiền xem ở tab Tiền.",
};
export const waitingNote = (status: string) => (status in WAITING_NOTE ? WAITING_NOTE[status as CaseStatus] : "Chưa rõ hồ sơ đang chờ ai.");
/** Same, but a case closed without a decision says WHY (`closeReason`), never just "bị từ chối". */
export function waitingNoteFor(c: { status?: string | null; closeReason?: string | null }): string {
  if ((c.status === "REJECTED_INTAKE" || c.status === "CLOSED") && c.closeReason && c.closeReason in CLOSE_REASON_NOTE) return CLOSE_REASON_NOTE[c.closeReason as CloseReason];
  return waitingNote(c.status ?? "");
}

export const AWAITING_PARTIES_NOTE = "Khách và PT được báo trong ứng dụng khi hồ sơ chuyển sang bước này. Chưa có hạn trả lời.";

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
 * Cases that wait for something nobody in the UI can do, and who decides. `AWAITING_PARTIES` is not stuck.
 * A way out that the SERVER lists in `allowedActions` is never reported as "no way out".
 */
export function stuckState(d: DisputeCaseDetail): StuckState | null {
  const status = d.case?.status;
  const allowed = new Set<string>((d.allowedActions ?? []) as string[]);
  if (status === "POLICY_PENDING") {
    return {
      title: "Hồ sơ đang chờ quyết định về chính sách",
      body: "Kết luận hiện tại chưa cho phép lập đề xuất. Hệ thống chưa có thao tác đóng hồ sơ ở bước này; điều tra viên chỉ có thể quay lại bổ sung bằng chứng hoặc đánh giá lại.",
      owner: "Người quyết định: chủ dự án (chưa có chính sách).",
    };
  }
  if (status === "FINDING_RECORDED" && latestFinding(d.findings)?.finding === "NOT_A_DISPUTE") {
    if (allowed.has("closeNotADispute")) return null; // the close card says what happens
    return {
      title: "Kết luận «Không phải khiếu nại» không lập được đề xuất",
      body: "Hồ sơ này chỉ đóng được bằng thao tác «Đóng hồ sơ: không phải khiếu nại» ở tab Kết luận & đề xuất. Việc đóng không đụng tới buổi tập hay tiền.",
      owner: "Người đóng được: điều tra viên được giao hồ sơ.",
    };
  }
  if (status === "DECISION_APPROVED" && d.case?.execStatus !== "BUSINESS_DONE") {
    return {
      title: "Quyết định đã được duyệt",
      body: "Hồ sơ không còn bước nào ở phía điều tra. Duyệt chưa đổi buổi tập, quyền buổi hay tiền: việc thực thi nằm ở bước riêng, xem tab Thực thi.",
      owner: "Người thực hiện: bộ thực thi và quản trị viên, không phải điều tra viên.",
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
export const EXEC_UNREADABLE_HELP = "Máy chủ không trả trạng thái thực thi của hồ sơ này nên màn hình không suy đoán. Hãy tải lại hồ sơ.";
export const EXEC_NOT_APPLICABLE_HEADLINE = "Chưa có quyết định để thực thi";
export const EXEC_NOT_APPLICABLE_HELP = "Chỉ hồ sơ đã có quyết định được duyệt mới có bước thực thi. Duyệt không tự thực thi và không tự đổi buổi tập, quyền buổi hay tiền.";
/** Shown whenever the business part is done: it is never "money arrived". */
export const EXEC_BUSINESS_DONE_NOTE = "Phần nghiệp vụ của buổi tập đã được thực thi. Đây không phải xác nhận tiền đã về; trạng thái tiền xem ở tab Tiền.";

export const EXEC_TABLE: Array<{ status: ExecStatus; meaning: string; next: string }> = [
  { status: "NOT_STARTED", meaning: "Đã duyệt, chưa thực thi.", next: "Một quản trị viên bấm thực thi khi bộ thực thi bật." },
  { status: "EXECUTING", meaning: "Đang thực thi, hoặc lần trước chưa kết thúc.", next: "Nếu quá lâu, đối soát thực thi (sau ít nhất khoảng 1 phút)." },
  { status: "EXEC_BLOCKED", meaning: "Chưa thực thi được vì một điều kiện chưa đạt. Chưa có gì đổi ở buổi tập, quyền buổi hay tiền.", next: "Thử lại khi nguyên nhân đã hết." },
  { status: "BUSINESS_DONE", meaning: "Phần nghiệp vụ đã được thực thi. Chưa có nghĩa là tiền đã về.", next: "Xem tab Tiền để biết tiền." },
  { status: "NEEDS_HUMAN", meaning: "Cần người xem xét. Hệ thống không tự thử lại.", next: "Một quản trị viên xem xét và xác nhận. Xác nhận không chuyển tiền." },
];

export interface ExecBlockerRow {
  code: string;
  text: string;
}
export interface ExecHistoryRow {
  id: string;
  title: string;
  detail: string | null;
  at: string;
  actor: string;
}
export interface ExecView {
  /** false = the server returned no execution state */
  readable: boolean;
  /** false = no approved decision yet, so there is nothing to execute */
  applicable: boolean;
  status: ExecStatus | null;
  headline: string;
  lines: string[];
  /** the five-state reference table is shown only when there is something to execute */
  showTable: boolean;
  /** why it waits (EXEC_BLOCKED / NEEDS_HUMAN), business wording */
  reasonText: string | null;
  /** conditions that stand in the way RIGHT NOW (readable before pressing execute) */
  blockers: ExecBlockerRow[];
  history: ExecHistoryRow[];
  acknowledgements: Array<{ note: string | null; at: string; actor: string }>;
  decisionRef: string | null;
}

const execStatusOf = (raw: unknown): ExecStatus | null => (typeof raw === "string" && (EXEC_STATUSES as readonly string[]).includes(raw) ? (raw as ExecStatus) : null);
const VIETNAMESE_TEXT = /[àáâãăạảấầẩẫậắằẳẵặèéêẹẻẽếềểễệìíĩỉịòóôõơọỏốồổỗộớờởỡợùúũưụủứừửữựỳỵỷỹđ]/i;

/** Business wording of a block / blocker code; a code we do not know becomes a neutral sentence (or the server's Vietnamese sentence), never the code. */
export function blockReasonText(code: string | null | undefined, serverMessage?: string | null): string {
  if (code && Object.prototype.hasOwnProperty.call(EXEC_BLOCK_REASON_LABEL, code)) return EXEC_BLOCK_REASON_LABEL[code as keyof typeof EXEC_BLOCK_REASON_LABEL];
  if (serverMessage && VIETNAMESE_TEXT.test(serverMessage) && !looksLikeInternalCode(serverMessage)) return serverMessage.trim();
  return "Có một điều kiện chưa đạt.";
}

function actorWho(id: string | null | undefined, currentUserId: string | null | undefined): string {
  if (currentUserId && id === currentUserId) return "Bạn";
  return id ? `Quản trị viên (mã ${shortRef(id)})` : "Hệ thống";
}

function historyRow(h: ExecutionHistoryItem, currentUserId: string | null | undefined): ExecHistoryRow {
  const reason = h.blockedReason ? blockReasonText(h.blockedReason) : null;
  const note = proseOrNull(h.note);
  const who = actorWho(h.actorUserId, currentUserId);
  switch (h.state) {
    case "STARTED":
      return { id: h.id, title: `Bắt đầu thực thi (lần ${h.attempt >= 1 ? h.attempt : 1})`, detail: null, at: h.createdAt, actor: who };
    case "BLOCKED":
      return { id: h.id, title: "Chưa thực thi được, chưa có gì đổi", detail: reason ?? note, at: h.createdAt, actor: who };
    case "NEEDS_HUMAN":
      return { id: h.id, title: "Chuyển cho người xem xét", detail: reason, at: h.createdAt, actor: who };
    case "BUSINESS_DONE":
      return { id: h.id, title: "Phần nghiệp vụ đã xong", detail: "Không có nghĩa là tiền đã về.", at: h.createdAt, actor: who };
    default:
      return { id: h.id, title: "Bước thực thi khác", detail: note, at: h.createdAt, actor: who };
  }
}

/** Reads `execution.status` first, then `case.execStatus`. NEVER derives anything from `decision.execution` / `proposals[].execution` (gone from the server). */
export function describeExecution(d: DisputeCaseDetail, currentUserId?: string | null): ExecView {
  const ex = asRecord(d.execution);
  const c = asRecord(d.case);
  const status = execStatusOf(ex?.status) ?? execStatusOf(c?.execStatus);
  const blockersRaw = Array.isArray(ex?.blockers) ? (ex!.blockers as unknown[]) : [];
  const blockers: ExecBlockerRow[] = blockersRaw
    .map((b) => asRecord(b))
    .filter((b): b is Record<string, unknown> => !!b && typeof b.code === "string")
    .map((b) => ({ code: b.code as string, text: blockReasonText(b.code as string, typeof b.message === "string" ? b.message : null) }));
  const historyRaw = Array.isArray(ex?.history) ? (ex!.history as ExecutionHistoryItem[]) : [];
  const history = historyRaw
    .filter((h) => h && typeof h.id === "string")
    .map((h) => historyRow(h, currentUserId))
    .reverse();
  const acks = (Array.isArray(ex?.acknowledgements) ? (ex!.acknowledgements as Array<{ actorUserId: string; note: string | null; createdAt: string }>) : [])
    .filter((a) => a && typeof a.createdAt === "string")
    .map((a) => ({ note: proseOrNull(a.note), at: a.createdAt, actor: actorWho(a.actorUserId, currentUserId) }))
    .reverse();
  const decisionRef = typeof ex?.decisionId === "string" ? ex.decisionId : typeof c?.execDecisionId === "string" ? c.execDecisionId : null;
  const base = { blockers, history, acknowledgements: acks, decisionRef, reasonText: null as string | null };

  if (!status) {
    return { ...base, readable: false, applicable: false, status: null, headline: EXEC_UNREADABLE_HEADLINE, lines: [EXEC_UNREADABLE_HELP], showTable: false };
  }
  const approved = c?.status === "DECISION_APPROVED";
  if (status === "NOT_STARTED" && !approved) {
    return { ...base, readable: true, applicable: false, status, headline: EXEC_NOT_APPLICABLE_HEADLINE, lines: [EXEC_NOT_APPLICABLE_HELP], showTable: false };
  }
  const lines: string[] = [];
  let reasonText: string | null = null;
  const reasonCode = typeof ex?.blockedReason === "string" ? ex.blockedReason : null;
  const reasonServer = typeof ex?.blockedReasonText === "string" ? ex.blockedReasonText : null;
  if (status === "EXEC_BLOCKED") {
    reasonText = blockReasonText(reasonCode, reasonServer);
    lines.push(reasonText, "Chưa có gì đổi ở buổi tập, quyền buổi hay tiền.");
  }
  if (status === "BUSINESS_DONE") lines.push(EXEC_BUSINESS_DONE_NOTE);
  if (status === "NEEDS_HUMAN") {
    reasonText = reasonCode ? blockReasonText(reasonCode, reasonServer) : null;
    lines.push("Cần người xem xét. Hệ thống không tự thử lại.");
    if (reasonText) lines.push(reasonText);
  }
  if (status === "EXECUTING") lines.push("Nếu trạng thái này kéo dài, cần đối soát thực thi.");
  if (status === "NOT_STARTED") lines.push("Quyết định đã được duyệt nhưng chưa thực thi: buổi tập, quyền buổi và tiền chưa đổi.");
  return { ...base, reasonText, readable: true, applicable: true, status, headline: EXEC_STATUS_LABEL[status], lines, showTable: true };
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
  NEEDS_HUMAN_ACKNOWLEDGED: "Người xem xét xác nhận việc thực thi (không chuyển tiền)",
  CASE_CLOSED_ORPHAN: "Đóng hồ sơ: buổi tập không còn trong khiếu nại",
  CASE_CLOSED_NOT_A_DISPUTE: "Đóng hồ sơ: không phải khiếu nại",
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
/** R-14: the server returns at most `eventsLimit` (200) events, newest first, and says when older ones were cut. */
export function historyLimitNote(d: Pick<DisputeCaseDetail, "eventsLimit" | "eventsTruncated">): string | null {
  if (d.eventsTruncated === true) return `Chỉ hiện ${d.eventsLimit ?? 200} sự kiện gần nhất; hồ sơ còn những sự kiện cũ hơn không hiện ở đây.`;
  return null;
}
const summaryTypeText = (v: unknown) => (typeof v === "string" && v in CASE_TYPE_LABEL ? CASE_TYPE_LABEL[v as CaseType] : null);
/** Short facts of an event (`summary`), in words. Only keys we know are shown; an unknown key is dropped, never printed raw. */
export function eventSummaryParts(e: Pick<DisputeEvent, "summary">): string[] {
  const m = asRecord(e.summary);
  if (!m) return [];
  const out: string[] = [];
  const num = (k: string) => (typeof m[k] === "number" && Number.isFinite(m[k] as number) ? (m[k] as number) : null);
  if (num("added") !== null || num("unchanged") !== null) out.push(`Thu thập bằng chứng: thêm ${num("added") ?? 0}, giữ nguyên ${num("unchanged") ?? 0}`);
  if (Array.isArray(m.skippedUnavailable) && m.skippedUnavailable.length > 0) out.push(`${m.skippedUnavailable.length} nguồn không đọc được lần này, bản cũ được giữ`);
  if (num("evidenceRows") !== null) out.push(`${num("evidenceRows")} mục bằng chứng ban đầu`);
  if (num("legacyStatements") !== null && (num("legacyStatements") as number) > 0) out.push(`${num("legacyStatements")} lời khai lấy từ trường cũ của buổi`);
  if (m.provisionalClassification) out.push("Phân loại tạm");
  if (summaryTypeText(m.from) && summaryTypeText(m.to)) out.push(`Loại: ${summaryTypeText(m.from)} → ${summaryTypeText(m.to)}`);
  if (typeof m.result === "string" && m.result in POLICY_RESULT_LABEL) out.push(POLICY_RESULT_LABEL[m.result as PolicyResult]);
  if (Array.isArray(m.changedIds) && m.changedIds.length > 0) out.push(`${m.changedIds.length} bằng chứng đã thay đổi`);
  if (Array.isArray(m.staleLive) && m.staleLive.length > 0) out.push(`${m.staleLive.length} nguồn đã đổi nhưng chưa được thu lại`);
  return out;
}

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
