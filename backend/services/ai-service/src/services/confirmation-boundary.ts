import { normalizeAgentText } from "./fitness-agent-intent";

/**
 * Deterministic CONFIRMATION-INTENT boundary. A bare "Xác nhận cập nhật" / "Ok lưu đi" / "Tôi đồng ý" / "Đã lưu thành công chưa?" is never an
 * execution path (writes only happen through the confirmation card / the workflow's own confirmation step) and must never reach the
 * generic RAG model, which used to answer "✅ Đã lưu thành công!" although nothing had been saved.
 *
 * Recognition is ANCHORED to the whole (short) message — it is not a keyword-contains rule — so knowledge questions about confirmation
 * ("Giải thích cơ chế xác nhận cập nhật là gì?") and ordinary sentences that merely contain the word never match. A phrase that also NAMES
 * a specific artifact ("lưu lịch tập này", "lưu thực đơn này") is deliberately excluded too — that already has its own collision-aware
 * redirect (see proposeSaveGeneratedPlan / routePendingDraftTurn) and must keep dispatching through the normal intent-kind path, unshadowed.
 * Pure functions only: no I/O, no model.
 */
export type ConfirmationIntent = "CONFIRM" | "STATUS";

const FILLER = "(?:(?:ok|oke|okie|vang|da|uh|u|on roi|duoc roi|xong roi|vay|thoi|nhe|nha|the|roi|toi) )*";
const TAIL = "(?: (?:luon|di|nhe|nha|roi|nao|it|giup toi|giup minh))*";
const CONFIRM_RES: RegExp[] = [
  // "xác nhận", "xác nhận cập nhật", "tôi đồng ý", "chốt luôn"
  new RegExp(`^${FILLER}(?:xac nhan(?: cap nhat| thay doi)?|dong y|chot|confirm)${TAIL}$`),
  // "ok lưu đi", "lưu luôn" — BARE only (no named artifact)
  new RegExp(`^${FILLER}(?:luu|save)${TAIL}$`),
  // "coi như tôi đã xác nhận (rồi)"
  /^(?:cu )?(?:coi nhu|xem nhu) (?:toi )?da (?:bam |nhan )?(?:xac nhan|dong y|luu|chot)(?: roi)?$/,
];
// "đã lưu thành công chưa?", "lưu xong chưa", "cập nhật xong chưa"
const STATUS_RE = /^(?:da |co )?(?:luu|cap nhat|xac nhan)(?: (?:thanh cong|xong|roi))* chua$/;

export function classifyConfirmationUtterance(text: string): ConfirmationIntent | null {
  const s = normalizeAgentText(text).replace(/[.,!?;:"“”'‘’]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s || s.split(" ").length > 9) return null;
  if (STATUS_RE.test(s)) return "STATUS";
  if (CONFIRM_RES.some((re) => re.test(s))) return "CONFIRM";
  return null;
}

/** what the session's own persisted actions say (authoritative — derived from FitnessAgentAction rows, never from the model) */
export type ConfirmationState = "PENDING" | "EXECUTING" | "COMPLETED" | "CANCELLED" | "EXPIRED" | "NONE";

export function deriveConfirmationState(actions: { status: string; expiresAt: Date }[], now = new Date()): ConfirmationState {
  if (actions.some((a) => a.status === "PENDING" && a.expiresAt > now)) return "PENDING";
  const latest = actions[0]; // caller passes newest first
  if (!latest) return "NONE";
  if (latest.status === "EXECUTING") return "EXECUTING";
  if (latest.status === "COMPLETED") return "COMPLETED";
  if (latest.status === "CANCELLED") return "CANCELLED";
  if (latest.status === "PENDING" || latest.status === "EXPIRED") return "EXPIRED";
  return "NONE";
}

/** A terminal AgentWorkflowSession that reached AWAITING_SLOT_CONFIRMATION at some point (see
 * workflowStateRepository.findLatestProfileConfirmation) — the profile-change-confirmation
 * counterpart of a FitnessAgentAction row, from a completely separate table/lifecycle. */
export type ProfileWorkflowConfirmation = { status: string; updatedAt: Date };

/**
 * X4 follow-up (docs/conversational-intelligence-x4-followup-fix.md): a completed `UPDATE_GOAL`
 * (or any other workflow type that reached a profile-fact confirmation) is real, authoritative,
 * saved state — but it lives in AgentWorkflowSession, not FitnessAgentAction, so
 * deriveConfirmationState(actions) alone can never see it. This merges that second, independent
 * source in, purely by RECENCY — never by inferring anything from the assistant's own prior
 * text, and never by inventing a FitnessAgentAction row to represent it:
 *
 * - An OPEN/in-flight action (PENDING with a live TTL, or EXECUTING) always wins outright — a
 *   real confirmation card in front of the user, or a write actually in progress, is never
 *   shadowed by an older completed profile confirmation. (A genuinely pending profile workflow
 *   itself is caught earlier — tryConfirmationBoundary defers immediately whenever
 *   workflowStateRepository.findActive() finds one — so this function only ever receives
 *   TERMINAL profile-workflow rows.)
 * - Otherwise, whichever of the two independent events happened more recently is authoritative.
 *   This is the precedence rule: a newer cancelled/expired action correctly shadows an older
 *   completed profile confirmation ("no, don't tell them the OLD save when a NEWER thing was
 *   just cancelled"), and symmetrically a newer completed profile confirmation correctly
 *   shadows an older cancelled/completed action.
 */
export function mergeConfirmationState(
  actionState: ConfirmationState,
  actionAt: Date | null,
  profileWorkflow: ProfileWorkflowConfirmation | null,
): ConfirmationState {
  if (actionState === "PENDING" || actionState === "EXECUTING") return actionState;
  if (!profileWorkflow) return actionState;
  const workflowState: ConfirmationState =
    profileWorkflow.status === "COMPLETED" ? "COMPLETED" :
    profileWorkflow.status === "CANCELLED" ? "CANCELLED" :
    profileWorkflow.status === "EXPIRED" ? "EXPIRED" : "NONE";
  if (workflowState === "NONE") return actionState;
  if (actionState === "NONE" || !actionAt) return workflowState;
  return profileWorkflow.updatedAt.getTime() >= actionAt.getTime() ? workflowState : actionState;
}

export function confirmationBoundaryAnswer(intent: ConfirmationIntent, state: ConfirmationState): string {
  if (state === "PENDING") {
    return intent === "STATUS"
      ? "Chưa — mình chưa lưu gì cả. Thay đổi vẫn đang chờ bạn bấm nút **Xác nhận** trên thẻ xem trước (hoặc **Bỏ qua** để hủy)."
      : "Mình chưa lưu gì cả. Việc lưu chỉ được thực hiện khi bạn bấm nút **Xác nhận** trên thẻ xem trước đang chờ (hoặc **Bỏ qua** để hủy). Bạn vẫn có thể tiếp tục chỉnh sửa bản nháp bằng lời trước khi xác nhận.";
  }
  if (state === "EXECUTING") return "Thao tác trước đó đang được lưu, bạn chờ một chút rồi kiểm tra lại giúp mình nhé.";
  if (state === "COMPLETED") {
    return intent === "STATUS"
      ? "Rồi — thao tác gần nhất trong cuộc trò chuyện này đã được xác nhận và lưu. Hiện không còn gì đang chờ xác nhận."
      : "Thao tác gần nhất trong cuộc trò chuyện này đã được xác nhận và lưu rồi, nên hiện không còn gì đang chờ bạn xác nhận.";
  }
  if (state === "CANCELLED") {
    return intent === "STATUS"
      ? "Chưa — bản gần nhất đã được bỏ qua nên mình chưa lưu gì cả. Bạn nhắn lại yêu cầu nếu muốn mình soạn bản mới."
      : "Bản gần nhất đã được bỏ qua nên hiện không còn gì để xác nhận, và mình chưa lưu gì cả. Bạn nhắn lại yêu cầu nếu muốn mình soạn bản mới.";
  }
  if (state === "EXPIRED") {
    return "Yêu cầu chờ xác nhận gần nhất đã hết hạn nên mình chưa lưu gì cả và cũng không thể lưu nữa. Bạn nhắn lại yêu cầu để mình soạn bản mới nhé.";
  }
  return intent === "STATUS"
    ? "Chưa có thay đổi nào được lưu trong cuộc trò chuyện này — hiện không có thao tác nào đang chờ xác nhận."
    : "Hiện chưa có bản nháp hay thao tác nào đang chờ xác nhận, nên mình chưa lưu gì cả.";
}
