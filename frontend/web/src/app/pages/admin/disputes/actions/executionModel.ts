/**
 * D5 - pure model of the execution actions (A27 execute, A28 reconcile, A29 acknowledge-needs-human) and of closing a case without a decision
 * (A25 / A26): when each control exists, the exact confirmation sentences, and the wording of every answer. No React, no I/O.
 *
 * Hard rules kept here:
 *  - a control exists only when the server's `allowedActions` lists it AND `capabilities` says the `execution` flag is effective;
 *    when the flag is off the page shows a muted line saying so instead of a dead button;
 *  - `BUSINESS_DONE` never says money arrived (the money axis is the `financial` block);
 *  - acknowledging NEEDS_HUMAN moves NO money, and `STAYS_LOCKED` is shown as exactly that (a lock that stays), never as success;
 *  - the decision id sent by execute only CHOOSES among the case's approvals: no outcome, amount or user id.
 */
import type { AckNeedsHumanResult, Capabilities, CloseResult, DisputeCaseDetail, ExecuteResult, ReconcileResult } from "../disputeCaseTypes";
import { OUTCOME_LABEL } from "../disputeCaseLabels";
import { availability, type Availability } from "./actionModel";

// ───────────────────────────────────────────────────────────── wording ──
export const EXECUTE_CONFIRM_NOTICE = "Thao tác sẽ đổi trạng thái buổi, quyền buổi và tiền. Chỉ có thể chạy lại, không thể hoàn tác.";
export const RECONCILE_CONFIRM_NOTICE = "Thao tác đọc trạng thái thật của buổi rồi có thể chạy nốt phần còn dở, tức là đổi trạng thái buổi, quyền buổi và tiền. Chỉ có thể chạy lại, không thể hoàn tác.";
export const ACK_NEEDS_HUMAN_NOTICE = "Xác nhận này không chuyển tiền và không chạy lại quyết định. Lời xác nhận của bạn luôn được ghi vào lịch sử.";
export const ACK_NEEDS_HUMAN_HELP =
  "Dùng sau khi bạn đã xem buổi tập. Nếu buổi đã được phán đúng theo quyết định này, hồ sơ được ghi hoàn tất phần nghiệp vụ. Nếu không, hồ sơ vẫn bị khoá ở trạng thái «Cần người xem xét» và hệ thống nói rõ lý do.";
export const CLOSE_ORPHAN_NOTICE = "Đóng hồ sơ không có quyết định. Không đổi buổi tập, quyền buổi hay tiền.";
export const CLOSE_NOT_A_DISPUTE_NOTICE = "Đóng hồ sơ không có quyết định. Không đổi buổi tập, quyền buổi hay tiền; buổi vẫn ở trạng thái khiếu nại và quay lại hàng đợi.";
export const EXECUTION_OFF_LINE = "Bộ thực thi quyết định đang tắt ở môi trường này nên chưa có nút thực thi, đối soát hay xác nhận. Quyết định đã duyệt được giữ nguyên, chưa đổi gì ở buổi tập, quyền buổi hay tiền.";
export const EXECUTION_UNKNOWN_LINE = "Chưa đọc được việc bộ thực thi đang bật hay tắt nên chưa hiện nút thực thi. Hãy tải lại hồ sơ.";

// ───────────────────────────────────────────────────── which controls ──
export type ExecutionGate = "off" | "unknown" | "on";
/** `capabilities.execution` decides whether the executor buttons may exist at all (`null` = the capabilities read did not answer). */
export function executionGate(capabilities: Pick<Capabilities, "execution"> | null | undefined): ExecutionGate {
  if (!capabilities) return "unknown";
  return capabilities.execution === true ? "on" : "off";
}

export interface ExecutionControls {
  gate: ExecutionGate;
  /** the muted line to show instead of the controls (flag off / unknown); null when the controls may show */
  line: string | null;
  execute: boolean;
  reconcile: boolean;
  ackNeedsHuman: boolean;
}
export function executionControls(detail: DisputeCaseDetail, userId: string | null | undefined, capabilities: Pick<Capabilities, "execution"> | null | undefined): ExecutionControls {
  const a: Availability = availability(detail, userId);
  const gate = executionGate(capabilities);
  const applicable = detail.case?.status === "DECISION_APPROVED";
  const none = { execute: false, reconcile: false, ackNeedsHuman: false };
  if (!a.signedIn || !applicable) return { gate, line: null, ...none };
  if (gate === "off") return { gate, line: EXECUTION_OFF_LINE, ...none };
  if (gate === "unknown") return { gate, line: EXECUTION_UNKNOWN_LINE, ...none };
  return { gate, line: null, execute: a.execute, reconcile: a.reconcile, ackNeedsHuman: a.ackNeedsHuman };
}

/** The decision to run: only used to CHOOSE among the case's approvals (the executor re-reads and re-checks everything). */
export function decisionIdOf(detail: Pick<DisputeCaseDetail, "decision" | "execution" | "case">): string | undefined {
  const id = detail.decision?.approvalId ?? detail.execution?.decisionId ?? detail.case?.execDecisionId ?? undefined;
  return typeof id === "string" && id ? id : undefined;
}
export function executeBody(detail: Pick<DisputeCaseDetail, "decision" | "execution" | "case">): { decisionId?: string } {
  const id = decisionIdOf(detail);
  return id ? { decisionId: id } : {};
}

// ─────────────────────────────────────────────────────────── answers ──
export interface ResultText {
  tone: "success" | "warning" | "info";
  text: string;
}

export function executeResultText(r: ExecuteResult): ResultText {
  const outcome = r.outcome in OUTCOME_LABEL ? OUTCOME_LABEL[r.outcome] : "kết quả của quyết định";
  const head = r.replayed ? "Quyết định này đã được thực thi trước đó nên không chạy lại." : "Đã thực thi phần nghiệp vụ của quyết định.";
  return { tone: "success", text: `${head} Buổi tập: ${outcome}. Đây chưa phải xác nhận tiền đã về: xem trạng thái tiền ở tab Tiền.` };
}

export function reconcileResultText(r: ReconcileResult): ResultText {
  switch (r.action) {
    case "NOTHING_TO_RECONCILE":
      return { tone: "info", text: "Không có lần thực thi nào đang dở nên không đổi gì." };
    case "RERAN_CORE":
      return { tone: "success", text: "Đã chạy nốt phần còn dở và ghi hoàn tất phần nghiệp vụ. Đây chưa phải xác nhận tiền đã về: xem tab Tiền." };
    case "BUSINESS_DONE":
      return { tone: "success", text: "Buổi tập đã được phán đúng theo quyết định này nên hồ sơ được ghi hoàn tất phần nghiệp vụ. Không chạy lại gì. Xem tab Tiền để biết tiền." };
    case "NEEDS_HUMAN":
      return { tone: "warning", text: "Trạng thái của buổi tập và quyết định không khớp nên hồ sơ chuyển sang «Cần người xem xét». Hệ thống không tự thử lại." };
    default:
      return { tone: "info", text: "Đã đối soát. Hãy tải lại hồ sơ để xem trạng thái." };
  }
}

const STAYS_LOCKED_REASON: Record<string, string> = {
  SESSION_STILL_DISPUTED_FINISHING_WOULD_MOVE_MONEY: "Buổi tập vẫn đang ở trạng thái khiếu nại: hoàn tất sẽ chạy phán quyết và có thể chuyển tiền, nên hồ sơ giữ nguyên khoá.",
  SESSION_RULED_ELSEWHERE_OR_MISMATCH: "Buổi tập đã được xử lý bằng một đường khác hoặc kết quả không khớp quyết định, nên hồ sơ giữ nguyên khoá.",
};
/** `STAYS_LOCKED` is HTTP 200 but NOT a success: the lock stays, and the acknowledgement is only recorded. */
export function ackNeedsHumanResultText(r: AckNeedsHumanResult): ResultText {
  if (r.action === "BUSINESS_DONE") {
    return {
      tone: "success",
      text: "Buổi tập đã được phán đúng theo chính quyết định này nên hồ sơ được ghi hoàn tất phần nghiệp vụ. Thao tác này không chuyển khoản tiền nào; xem trạng thái tiền ở tab Tiền.",
    };
  }
  const why = (r.reason && STAYS_LOCKED_REASON[r.reason]) || "Hồ sơ giữ nguyên khoá ở trạng thái «Cần người xem xét».";
  return {
    tone: "warning",
    text: `Hồ sơ vẫn bị khoá ở trạng thái «Cần người xem xét». ${why} Lời xác nhận của bạn đã được ghi vào lịch sử; không có tiền nào được chuyển.`,
  };
}

export function closeResultText(kind: "orphan" | "notADispute", r: CloseResult): ResultText {
  return {
    tone: "success",
    text:
      kind === "orphan"
        ? "Đã đóng hồ sơ vì buổi tập không còn trong khiếu nại. Không có quyết định nào, và buổi tập, quyền buổi, tiền không bị đổi."
        : "Đã đóng hồ sơ vì kết luận là «Không phải khiếu nại». Buổi tập không bị đổi và quay lại hàng đợi; không đụng tới tiền.",
  };
}
