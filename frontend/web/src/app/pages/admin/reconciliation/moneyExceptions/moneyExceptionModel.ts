/**
 * D7 - pure model of the two money-exception views: flags -> what the screen may show, who sees which action, the honest sentence for every
 * execution outcome, form validation and the exact request bodies, and the links from the existing reconciliation groups.
 * No React, no I/O (runs under `tsx --test`).
 *
 * Hard rules kept here:
 *  - the server stays the authority: every gate below only HIDES or DISABLES a control the server would refuse, never grants one;
 *  - a flag that is off OR unknown shows NO write control (fail closed);
 *  - bodies carry only the documented fields: no amount, no userId, no outcome - ever (the client file has no parameter for them);
 *  - "đã hoàn / đã ghi có" is said ONLY for an execution the server reported as EXECUTED (and the amount only from its `creditedToClient`).
 */
import { parseCents } from "../../adminFinanceOverview.utils";
import type { SettlementAttentionItem } from "../../adminReconciliation.utils";
import { outlineObligation, type Tone } from "./moneyExceptionLabels";
import { reasonOrGeneric } from "./moneyExceptionText";
import {
  liveProposal,
  openRecovery,
  type D65bDetail,
  type D65bExecutionView,
  type D65bSessionPreview,
  type D65bSummary,
  type FlagState,
  type LateExecutionView,
  type LateItem,
  type RecoveryApproveView,
} from "./moneyExceptionTypes";

// ─────────────────────────────────────────────────────────── limits ──
/** Copied from the controllers' Zod schemas (`d65b-resolution.controller.ts`, `late-open-reconciliation.controller.ts`). */
export const LIMITS = {
  reason: 2000,
  verificationNote: 4000,
  policyBasis: 4000,
  refMax: 500,
  refsMin: 1,
  refsMax: 20,
  assigneeId: 128,
} as const;

export const REQUIRED = "Cần nhập nội dung này.";
export const tooLong = (max: number) => `Tối đa ${max.toLocaleString("vi-VN")} ký tự.`;

// ──────────────────────────────────────────────────────────── flags ──
export type FlagMode = "on" | "off" | "unknown";
export const flagMode = (f: FlagState): FlagMode => (f === true ? "on" : f === false ? "off" : "unknown");
/** Write controls exist only when the server said the flag is effective. */
export const canWrite = (f: FlagState): boolean => f === true;

export const D65B_OFF_LINE = "Chức năng giải quyết khoản đang giữ của buổi PT vắng đang tắt. Bạn chỉ xem được; chưa có thao tác ghi nào.";
export const D65B_UNKNOWN_LINE = "Chưa đọc được trạng thái bật/tắt của chức năng giải quyết khoản đang giữ. Để an toàn, chỉ hiện phần xem.";
export const LATE_OFF_LINE = "Chức năng đối soát khoản bồi thường đến muộn đang tắt. Bạn chỉ xem được; chưa có thao tác ghi nào.";
export const LATE_UNKNOWN_LINE = "Chưa đọc được trạng thái bật/tắt của chức năng đối soát khoản bồi thường đến muộn. Để an toàn, chỉ hiện phần xem.";
/** Said whatever the flag is: an OPEN late-arrival compensation is not money in the client's wallet. */
export const LATE_NOT_PAID_LINE = "Khoản bồi thường đến muộn còn mở là khoản CHƯA được trả cho khách. Khi chức năng này đang tắt, không có đường nào trả khoản đó.";

export function flagLine(mode: FlagMode, which: "d65b" | "late"): string | null {
  if (mode === "on") return null;
  if (which === "d65b") return mode === "off" ? D65B_OFF_LINE : D65B_UNKNOWN_LINE;
  return mode === "off" ? LATE_OFF_LINE : LATE_UNKNOWN_LINE;
}

// ───────────────────────────────────────────────────── action gating ──
export interface ActionGate {
  /** the control is rendered at all */
  show: boolean;
  /** rendered but not pressable, with the reason beside it */
  disabledReason: string | null;
}
const HIDDEN: ActionGate = { show: false, disabledReason: null };
const SHOWN: ActionGate = { show: true, disabledReason: null };
const BLOCKED = (reason: string): ActionGate => ({ show: true, disabledReason: reason });

export const WHO_PROPOSED = "Bạn là người lập đề xuất này nên không duyệt được. Cần một quản trị viên thứ hai.";
export const WHO_APPROVED_ONLY = "Chỉ người đã duyệt đề xuất này mới chạy lại được phần ghi có.";
export const WHO_ASSIGNEE = "Bạn đang phụ trách dòng này nên không tự duyệt được. Cần một quản trị viên khác.";
export const WHO_OPENED_RECOVERY = "Bạn là người mở đợt chạy bổ sung này nên không duyệt được. Cần một quản trị viên khác.";
export const WHO_OTHER_ASSIGNEE = "Dòng này do quản trị viên khác phụ trách. Họ lập đề xuất, hoặc chuyển giao cho bạn.";

export interface D65bGates {
  propose: ActionGate;
  approve: ActionGate;
  resume: ActionGate;
  reject: ActionGate;
  handover: ActionGate;
}

/** D65-B (P4 / P5). `me` = the signed-in admin's id (a hint only: the server re-checks four eyes and the contract parties). */
export function d65bGates(input: { flag: FlagState; me: string | null; resolution: D65bSummary | null; preview: D65bSessionPreview | null }): D65bGates {
  const none = { propose: HIDDEN, approve: HIDDEN, resume: HIDDEN, reject: HIDDEN, handover: HIDDEN };
  if (!canWrite(input.flag) || !input.me) return none;
  const r = input.resolution;
  if (!r) {
    // no proposal yet: a proposal may be made only if the server's own preview says this session is eligible
    return { ...none, propose: input.preview && input.preview.assessment.eligible ? SHOWN : HIDDEN };
  }
  if (r.status === "REJECTED") return { ...none, propose: input.preview?.assessment.eligible ? SHOWN : HIDDEN };
  if (r.status === "PROPOSED") {
    const second = r.proposedBy === input.me ? BLOCKED(WHO_PROPOSED) : SHOWN;
    return { ...none, approve: second, reject: second };
  }
  if (r.status === "APPROVED_NOT_EXECUTED") return {
    ...none,
    resume: r.approvedBy === input.me ? SHOWN : BLOCKED(WHO_APPROVED_ONLY),
    // The backend verifies that the former approver is no longer an active ADMIN.
    // The UI cannot know that from a stale directory read; leave the server as authority.
    handover: r.proposedBy === input.me || r.approvedBy === input.me ? HIDDEN : SHOWN,
  };
  return none;
}

export interface LateGates {
  claim: ActionGate;
  handover: ActionGate;
  propose: ActionGate;
  approve: ActionGate;
  reject: ActionGate;
  retry: ActionGate;
  openRecovery: ActionGate;
  approveRecovery: ActionGate;
  rejectRecovery: ActionGate;
}

export function lateGates(input: { flag: FlagState; me: string | null; item: LateItem }): LateGates {
  const off: LateGates = { claim: HIDDEN, handover: HIDDEN, propose: HIDDEN, approve: HIDDEN, reject: HIDDEN, retry: HIDDEN, openRecovery: HIDDEN, approveRecovery: HIDDEN, rejectRecovery: HIDDEN };
  if (!canWrite(input.flag) || !input.me) return off;
  const { item, me } = input;
  const eligible = item.assessment.eligible;
  const live = liveProposal(item);
  const rec = openRecovery(item);
  const mine = (id: string | null) => !!me && id === me;
  const g = { ...off };

  // the pre-proposal steps need the row to be actionable right now (the server's assessment)
  if (eligible && !live) {
    if (item.assignee === null) g.claim = SHOWN;
    g.propose = item.assignee === null || mine(item.assignee) ? SHOWN : BLOCKED(WHO_OTHER_ASSIGNEE);
  }
  if (eligible && item.status !== "EXECUTED" && item.assignee !== null) g.handover = SHOWN;
  if (eligible && live && live.approvedAt === null && live.outcome === null) {
    g.approve = mine(live.proposedBy) ? BLOCKED(WHO_PROPOSED) : mine(item.assignee) ? BLOCKED(WHO_ASSIGNEE) : SHOWN;
    g.reject = SHOWN;
  }
  if (live && live.approvedAt !== null && live.outcome === null && (item.status === "APPROVED" || item.status === "EXECUTION_FAILED")) g.retry = SHOWN;
  if (live && live.approvedAt !== null && live.outcome === null && item.status === "EXECUTION_EXHAUSTED" && !rec && (item.attempts?.recoveriesLeft ?? 0) > 0) g.openRecovery = SHOWN;
  if (rec) {
    g.rejectRecovery = SHOWN;
    g.approveRecovery = mine(rec.openedBy) ? BLOCKED(WHO_OPENED_RECOVERY) : live && mine(live.proposedBy) ? BLOCKED(WHO_PROPOSED) : mine(item.assignee) ? BLOCKED(WHO_ASSIGNEE) : SHOWN;
  }
  return g;
}

// ───────────────────────────────────────────── honest result notes ──
export interface ResultNote {
  tone: Tone;
  title: string;
  text: string;
}

/** What may be said after P5 (approve / resume). Only `EXECUTED` + a server amount says the client was credited. */
export function d65bResultNote(view: D65bExecutionView, formatMoney: (v: string | null) => string, handedOver = false): ResultNote {
  if (view.kind === "EXECUTED") {
    const amount = view.creditedToClient ? ` ${formatMoney(view.creditedToClient)}` : "";
    return {
      tone: "success",
      title: "Sổ cái đã xác nhận ghi có cho khách",
      text: `Sổ cái đã ghi${amount} vào ví Gymini của khách${view.replayed ? " (kết quả đã có từ lần chạy trước)" : ""}. Đây là ghi vào ví Gymini, không phải chuyển khoản ngân hàng.`,
    };
  }
  if (view.kind === "NOT_EXECUTED") {
    return {
      tone: "warning",
      title: "Đã duyệt, nhưng sổ cái chưa xác nhận ghi có — chưa được nói là đã hoàn",
      text: `${reasonOrGeneric(view.code, "Sổ cái chưa xác nhận khoản ghi có cho khách.")} Khoản vẫn đang được giữ. ${handedOver ? "Quản trị viên đã tiếp quản có thể dùng lại nút «Tiếp quản và chạy tiếp» sau khi kiểm tra trạng thái; máy chủ sẽ xác minh lại điều kiện bàn giao." : "Người đã duyệt chạy lại bằng nút «Chạy lại việc ghi có». Nếu người đó đã rời vai quản trị, một quản trị viên thứ ba có thể tiếp quản sau khi máy chủ xác minh."} Tiền chỉ được ghi một lần dù chạy nhiều lần.`,
    };
  }
  return {
    tone: "pending",
    title: "Chưa biết kết quả ghi có",
    text: "Phản hồi không cho biết sổ cái đã ghi có hay chưa. Hãy tải lại trạng thái; đừng coi là đã hoàn cho tới khi trạng thái hiện «Sổ cái đã ghi có cho khách».",
  };
}

/** What may be said after L6 / L8 / L10 (HTTP 200 whatever the execution). */
export function lateResultNote(view: LateExecutionView, formatMoney: (v: string | null) => string, attempts?: { failures: number; cap: number } | null): ResultNote {
  switch (view.kind) {
    case "EXECUTED": {
      const after = view.obligationAfter;
      const o = outlineObligation(after);
      const paid = after && after.paid ? ` Đã ghi ${formatMoney(after.paid)} vào ví Gymini của khách.` : "";
      const rest = o.stillOwed === true && after ? ` Vẫn còn ${formatMoney(after.unpaid)} chưa trả.` : "";
      return {
        tone: o.stillOwed === true ? "warning" : "success",
        title: "Sổ cái đã ghi nhận",
        text: `Lần chạy này đã được sổ cái ghi nhận.${paid}${rest} Đây là ghi vào ví Gymini, không phải chuyển khoản ngân hàng.`,
      };
    }
    case "BLOCKED":
      return {
        tone: "danger",
        title: "Chưa chạy được — bị chặn",
        text: `${reasonOrGeneric(view.code, "Một điều kiện kiểm tra lúc chạy không còn đúng.")} Chưa có tiền nào được ghi; khoản vẫn còn nợ.`,
      };
    case "FAILED": {
      const left = attempts ? ` Đã thất bại ${attempts.failures}/${attempts.cap} lượt.` : "";
      return {
        tone: "warning",
        title: "Lần chạy chưa thành công",
        text: `${reasonOrGeneric(view.code, "Lần chạy chưa ghi nhận được vào sổ cái.")}${left} Chưa xác nhận có tiền nào được ghi; có thể chạy lại khi còn lượt.`,
      };
    }
    case "IN_FLIGHT":
      return {
        tone: "pending",
        title: "Một lần chạy khác đang xử lý dòng này",
        text: "Đừng chạy lại ngay. Hãy tải lại trạng thái sau ít phút để xem kết quả thật từ sổ cái.",
      };
    default:
      return { tone: "pending", title: "Chưa biết kết quả chạy", text: "Phản hồi không cho biết sổ cái đã ghi hay chưa. Hãy tải lại trạng thái trước khi làm gì tiếp." };
  }
}

export function recoveryResultNote(view: RecoveryApproveView, formatMoney: (v: string | null) => string, attempts?: { failures: number; cap: number } | null): ResultNote {
  if (view.kind === "APPLIED") return lateResultNote(view.execution, formatMoney, attempts);
  if (view.kind === "HALTED") {
    return {
      tone: "danger",
      title: "Đợt chạy bổ sung dừng, không chạy gì",
      text: `${reasonOrGeneric(view.haltCode, "Có điều chưa rõ trong sổ cái.")} Chưa có tiền nào được ghi; cần một người xem xét.`,
    };
  }
  return { tone: "pending", title: "Chưa biết kết quả", text: "Phản hồi không cho biết kết quả. Hãy tải lại trạng thái trước khi làm gì tiếp." };
}

// ───────────────────────────────────────── ledger observations ──
/** Does the string money value say "more than zero"? (a comparison, not arithmetic); unreadable -> null. */
export function isPositiveMoney(v: string | null | undefined): boolean | null {
  const c = parseCents(v ?? null);
  return c === null ? null : c > 0n;
}

/** A D65-B detail that the screen may call "paid into the wallet": EXECUTED and a server amount. */
export function d65bCredited(d: Pick<D65bDetail, "status" | "creditedToClient">): string | null {
  return d.status === "EXECUTED" ? d.creditedToClient : null;
}

// ───────────────────────────────────────────────────────────── forms ──
export type Errors = Record<string, string>;

/** One reference per line; blank lines are dropped; each line is trimmed (the server trims too). */
export function splitRefs(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

const lengthError = (text: string, max: number): string | null => {
  const n = text.trim().length;
  if (n === 0) return REQUIRED;
  return n > max ? tooLong(max) : null;
};

export function validateRefs(text: string): string | null {
  const refs = splitRefs(text);
  if (refs.length < LIMITS.refsMin) return "Cần ít nhất một tham chiếu bằng chứng.";
  if (refs.length > LIMITS.refsMax) return `Tối đa ${LIMITS.refsMax} tham chiếu, mỗi dòng một tham chiếu.`;
  if (refs.some((r) => r.length > LIMITS.refMax)) return `Mỗi tham chiếu tối đa ${LIMITS.refMax} ký tự.`;
  return null;
}

export type D65bRef = { type: "EVIDENCE"; id: string; contentHash: string } | { type: "LEDGER_OP"; key: string };
export interface ProposeD65bForm {
  reason: string;
  refs: D65bRef[];
}
export function validateProposeD65b(f: ProposeD65bForm): Errors {
  const e: Errors = {};
  const r = lengthError(f.reason, LIMITS.reason);
  if (r) e.reason = r;
  if (f.refs.length < 1 || f.refs.length > 20) e.evidenceRefs = "Cần từ 1 đến 20 tham chiếu đã được lưu trong hệ thống.";
  else if (f.refs.some((ref) => ref.type === "EVIDENCE" ? !ref.id.trim() || ref.id.trim().length > 64 || !/^[a-fA-F0-9]{64}$/.test(ref.contentHash.trim()) : !ref.key.trim() || ref.key.trim().length > 200)) {
    e.evidenceRefs = "Tham chiếu bằng chứng cần mã bản ghi và hash SHA-256; thao tác sổ cái cần khoá hợp lệ. Máy chủ sẽ kiểm tra chúng thuộc đúng buổi và hợp đồng.";
  }
  return e;
}
export function buildProposeD65b(f: ProposeD65bForm) {
  return { reason: f.reason.trim(), evidenceRefs: f.refs.map((ref) => ref.type === "EVIDENCE" ? { type: "EVIDENCE" as const, id: ref.id.trim(), contentHash: ref.contentHash.trim() } : { type: "LEDGER_OP" as const, key: ref.key.trim() }) };
}

export interface ProposeLateForm {
  reason: string;
  verificationNote: string;
  refsText: string;
  policyBasis: string;
}
export function validateProposeLate(f: ProposeLateForm): Errors {
  const e: Errors = {};
  const r = lengthError(f.reason, LIMITS.reason);
  if (r) e.reason = r;
  const v = lengthError(f.verificationNote, LIMITS.verificationNote);
  if (v) e.verificationNote = v;
  const p = lengthError(f.policyBasis, LIMITS.policyBasis);
  if (p) e.policyBasis = p;
  const refs = validateRefs(f.refsText);
  if (refs) e.evidenceRefs = refs;
  return e;
}
export function buildProposeLate(f: ProposeLateForm) {
  return { reason: f.reason.trim(), verificationNote: f.verificationNote.trim(), evidenceRefs: splitRefs(f.refsText), policyBasis: f.policyBasis.trim() };
}

export interface ReasonForm {
  reason: string;
}
export function validateReason(f: ReasonForm): Errors {
  const r = lengthError(f.reason, LIMITS.reason);
  return r ? { reason: r } : {};
}

export interface ApproveForm {
  reason: string;
  coi: boolean;
}
export const COI_REQUIRED = "Cần tích khai báo không có xung đột lợi ích.";
export function validateApprove(f: ApproveForm): Errors {
  const e = validateReason(f);
  if (!f.coi) e.coi = COI_REQUIRED;
  return e;
}
/** The declaration is a literal `true`: the box must be ticked before this body can exist. */
export function buildApprove(f: ApproveForm) {
  return { reason: f.reason.trim(), conflictOfInterestDeclaredNone: f.coi === true };
}

export interface HandoverForm {
  newAssigneeId: string;
  reason: string;
}
export function validateHandover(f: HandoverForm): Errors {
  const e = validateReason(f);
  if (!f.newAssigneeId || f.newAssigneeId.length > LIMITS.assigneeId) e.newAssigneeId = "Hãy chọn một quản trị viên trong danh sách.";
  return e;
}
export function buildHandover(f: HandoverForm) {
  return { newAssigneeId: f.newAssigneeId, reason: f.reason.trim() };
}

// ─────────────────────────────────────────── confirm wording (§4) ──
export const NOTICE_APPROVE_MONEY = "Hệ thống sẽ chi từ sổ cái theo khoản đã đề xuất.";
export const NOTICE_HANDOVER = "Người nhận sẽ có quyền làm mọi bước đối soát.";
export const NOTICE_REJECT = "Đề xuất bị bác; dòng này quay lại bước chờ lập đề xuất mới.";
export const NOTICE_PROPOSE_D65B = "Đề xuất chỉ chờ người thứ hai duyệt. Chưa có khoản tiền nào được chuyển ở bước này.";
export const NOTICE_PROPOSE_LATE = "Đề xuất chỉ chờ người thứ hai duyệt. Chưa có khoản tiền nào được chuyển ở bước này.";
export const NOTICE_CLAIM = "Bạn sẽ chịu trách nhiệm làm dòng này. Người phụ trách không được tự duyệt đề xuất của mình.";
export const NOTICE_RETRY = "Thao tác chạy lại bước tiền đã được duyệt. Sổ cái chỉ ghi một lần dù chạy nhiều lần.";
export const NOTICE_OPEN_RECOVERY = "Hệ thống sẽ đọc lại sổ cái và phân loại cách xử lý. Chưa có khoản tiền nào được chuyển ở bước này.";
export const NOTICE_RESUME = "Chạy lại việc ghi có đã duyệt. Sổ cái chỉ ghi một lần dù chạy nhiều lần.";

// ───────────────────────────────────── links from the existing groups ──
export type MoneyView = "held-no-show" | "late-open";
export interface ExceptionLink {
  view: MoneyView;
  /** the query string to open (`view` + the id the target view reads) */
  search: string;
  label: string;
}

const LATE_STEP_KINDS: ReadonlySet<string> = new Set(["SESSION_RELEASE", "PT_NO_SHOW_COMPENSATION", "UNRESOLVED_SESSION_RESOLUTION"]);
const UUIDISH = /^[0-9a-fA-F-]{8,64}$/;

/**
 * Links from a row of «Tất toán cần người xử lý» into the money-exception views. The ids are the row's own `id` (= the settlement row id the
 * late-open API is keyed on) and `sessionId` (the key of the D65-B preview). Only rows waiting for a person (NEEDS_HUMAN / UNCONFIRMED) and of a
 * session money step get a link; the target view says plainly if the row turns out not to belong to its queue. Nothing is summed or merged.
 */
export function exceptionLinksFor(row: Pick<SettlementAttentionItem, "id" | "kind" | "reason" | "sessionId">): ExceptionLink[] {
  const waiting = row.reason === "NEEDS_HUMAN" || row.reason === "UNCONFIRMED";
  if (!waiting || !row.sessionId || !UUIDISH.test(row.sessionId) || !UUIDISH.test(row.id) || !LATE_STEP_KINDS.has(row.kind)) return [];
  const out: ExceptionLink[] = [];
  if (row.kind === "PT_NO_SHOW_COMPENSATION" && row.reason === "UNCONFIRMED") {
    out.push({ view: "held-no-show", search: `view=held-no-show&session=${encodeURIComponent(row.sessionId)}`, label: "Xem khoản giữ của buổi PT vắng" });
  }
  out.push({ view: "late-open", search: `view=late-open&row=${encodeURIComponent(row.id)}`, label: "Xem đối soát bồi thường đến muộn" });
  return out;
}

/** The ids the views read from the URL; anything that is not a plain id is ignored. */
export function idParam(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  return UUIDISH.test(v) ? v : null;
}
