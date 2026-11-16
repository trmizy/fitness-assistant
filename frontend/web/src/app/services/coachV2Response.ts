/**
 * AI Coach × Multi-Agent V2 — response adapter (M9.3-T1). PURE: no React, no network, no storage, no import.meta, so it is
 * unit-testable with node:test like the other pure frontend modules.
 *
 * Contract it adapts (verified against backend `services/coach-bridge.middleware.ts` mapV2 / mapBoundary, M9.2-T3, commit
 * 687d2653 — not guessed):
 *   200 { success: true, data: { question, answer, sessionId?, engine: "multi-agent-v2",
 *         v2: { status, kind, block?, agents: string[], turnId?, traceId?, replayed, historyRecorded } } }
 *   a V1-served request has NO `engine` / `v2` field (it is the unchanged V1 payload) → parseCoachV2 returns null.
 *   errors: { success: false, error: { code, message } } with
 *     404 SESSION_NOT_FOUND · 409 OPERATION_IN_PROGRESS (+ Retry-After) · 409 IDEMPOTENCY_KEY_CONFLICT · 503 SERVICE_UNAVAILABLE.
 *
 * Rules: a V2 state is shown as the backend returned it — a blocked / partial / failed turn is never presented as an ordinary
 * answer; nothing is invented (no structuredBlocks, evidence, safety notes, history, agents or trace unless the backend sent them);
 * an unknown status is shown as-is, never mapped to "answered".
 */
export type CoachV2Kind = "answered" | "partial" | "blocked" | "unavailable";

export interface CoachV2Meta {
  status: string;
  kind: CoachV2Kind;
  block?: string;
  agents: string[];
  turnId?: string;
  traceId?: string;
  replayed: boolean;
  historyRecorded: boolean;
}

export type CoachV2Tone = "ok" | "partial" | "blocked" | "error";
/** What the message bubble shows under the answer text. */
export interface CoachV2View {
  engineLabel: string;
  statusLabel: string;
  tone: CoachV2Tone;
  kind: CoachV2Kind;
  status: string;
  /** Only the agents the backend reported as executed; empty → nothing is shown. */
  agents: string[];
  /** Only when the backend sent it. */
  traceId?: string;
  replayed: boolean;
  /** Explains, when relevant, that this reply was not saved to the conversation history (backend-reported `historyRecorded: false`). */
  historyNote?: string;
}

const KINDS: ReadonlySet<string> = new Set(["answered", "partial", "blocked", "unavailable"]);
const isStr = (v: unknown): v is string => typeof v === "string";

/** Strict: returns null unless `data` is a well-formed multi-agent-v2 payload (so a V1 payload, or a malformed one, is never decorated). */
export function parseCoachV2(data: unknown): CoachV2Meta | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.engine !== "multi-agent-v2") return null;
  const v = d.v2;
  if (!v || typeof v !== "object") return null;
  const m = v as Record<string, unknown>;
  if (!isStr(m.status) || !isStr(m.kind) || !KINDS.has(m.kind)) return null;
  const agents = Array.isArray(m.agents) ? m.agents.filter(isStr) : [];
  return {
    status: m.status, kind: m.kind as CoachV2Kind,
    ...(isStr(m.block) ? { block: m.block } : {}),
    agents,
    ...(isStr(m.turnId) ? { turnId: m.turnId } : {}),
    ...(isStr(m.traceId) ? { traceId: m.traceId } : {}),
    replayed: m.replayed === true, historyRecorded: m.historyRecorded === true,
  };
}

// status → (label, tone). Only statuses the backend really returns; anything else falls through to the raw status.
const STATUS_VIEW: Readonly<Record<string, { label: string; tone: CoachV2Tone }>> = Object.freeze({
  ANSWERED: { label: "Đã trả lời", tone: "ok" },
  PARTIAL: { label: "Trả lời một phần — có phần chưa được xử lý trong lượt này", tone: "partial" },
  INSUFFICIENT_DATA: { label: "Chưa đủ dữ liệu để trả lời đầy đủ", tone: "partial" },
  MINOR_PROTECTED: { label: "Chế độ bảo vệ người dưới 18 tuổi — tư vấn cá nhân bị hạn chế", tone: "blocked" },
  PROFILE_UNVERIFIED: { label: "Chưa xác minh được hồ sơ (tuổi) — tư vấn cá nhân bị hạn chế", tone: "blocked" },
  SESSION_UNAVAILABLE: { label: "Chưa đọc được ngữ cảnh cuộc trò chuyện — tư vấn cá nhân tạm dừng", tone: "blocked" },
  SAFETY_BLOCKED: { label: "Yêu cầu bị chặn vì lý do an toàn", tone: "blocked" },
  ROUTING_UNDETERMINED: { label: "Chưa xác định được bạn hỏi về phần nào — chưa tư vấn cá nhân", tone: "blocked" },
  OUT_OF_SCOPE: { label: "Ngoài phạm vi tư vấn của AI Coach", tone: "blocked" },
  BLOCKED: { label: "Yêu cầu không được thực hiện", tone: "blocked" },
  INVALID_INPUT: { label: "Nội dung yêu cầu không hợp lệ", tone: "blocked" },
  UNAUTHENTICATED: { label: "Phiên đăng nhập không hợp lệ", tone: "blocked" },
  FAILED: { label: "Không trả lời được lúc này", tone: "error" },
  BUDGET_EXHAUSTED: { label: "Yêu cầu quá lớn để xử lý trong một lượt", tone: "error" },
});

export function describeCoachV2(meta: CoachV2Meta): CoachV2View {
  const known = STATUS_VIEW[meta.status];
  // an unknown status keeps its own name and a tone derived from `kind`; it is never promoted to "answered"
  const tone: CoachV2Tone = known?.tone ?? (meta.kind === "answered" ? "partial" : meta.kind === "partial" ? "partial" : meta.kind === "blocked" ? "blocked" : "error");
  return {
    engineLabel: "Multi-Agent V2 (DEV)",
    statusLabel: known?.label ?? `Trạng thái V2: ${meta.status}`,
    tone, kind: meta.kind, status: meta.status,
    agents: meta.agents,
    ...(meta.traceId ? { traceId: meta.traceId } : {}),
    replayed: meta.replayed,
    ...(!meta.historyRecorded ? { historyNote: "Lượt này không được lưu vào lịch sử hội thoại." } : {}),
  };
}

// ── failures ────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type CoachFailureKind = "in_progress" | "conflict" | "unauthorized" | "forbidden" | "session_not_found" | "unavailable" | "other";
export interface CoachFailureView {
  kind: CoachFailureKind;
  message: string;
  /** May the user press "Thử lại"? Retrying always reuses the ORIGINAL clientRequestId (never a new one). */
  canRetrySameRequest: boolean;
}

/**
 * HTTP failure → user text. 409 is split by the backend's own error code (OPERATION_IN_PROGRESS vs IDEMPOTENCY_KEY_CONFLICT);
 * a 409 with an unknown / missing code is treated as the safer "conflict" (no retry offered), never as in-progress.
 * Returns null for statuses this adapter has no special text for (the caller keeps its existing generic message).
 */
export function describeCoachFailure(status: number | undefined, code?: string): CoachFailureView | null {
  if (status === 409) {
    if (code === "OPERATION_IN_PROGRESS") {
      return { kind: "in_progress", canRetrySameRequest: true, message: "Tin nhắn này vẫn đang được xử lý. Hệ thống sẽ không chạy lại lượt đã bắt đầu — hãy chờ một chút rồi bấm “Thử lại” để nhận kết quả." };
    }
    return { kind: "conflict", canRetrySameRequest: false, message: "Mã yêu cầu này đã được dùng cho một tin nhắn khác (hoặc lượt trước không hoàn tất). Hãy gửi lại tin nhắn như một yêu cầu mới." };
  }
  if (status === 401) return { kind: "unauthorized", canRetrySameRequest: false, message: "Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Hãy đăng nhập lại." };
  if (status === 403) return { kind: "forbidden", canRetrySameRequest: false, message: "Bạn không có quyền dùng tính năng này." };
  if (status === 404 && code === "SESSION_NOT_FOUND") return { kind: "session_not_found", canRetrySameRequest: false, message: "Không tìm thấy cuộc trò chuyện này. Hãy bắt đầu một cuộc trò chuyện mới." };
  if (status === 503) return { kind: "unavailable", canRetrySameRequest: true, message: "AI Coach hiện chưa sẵn sàng. Bạn vẫn có thể dùng các tính năng khác và thử lại sau." };
  return null;
}
