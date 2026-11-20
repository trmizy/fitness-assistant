/**
 * AI plan revision + schedule sync (K9) — the pure parts. No React, no network.
 *
 * The AI plan (ai-service `WorkoutPlan`, `version`) and the program being trained (fitness-service `WorkoutProgram`,
 * `sourcePlanId` + `aiPlanVersion`) are two records. The source of truth for "has this plan been applied to the schedule"
 * is the CURRENT PROGRAM, never a local flag — same rule as web's AIPlansPage K9 patch
 * (docs/plan-review/aiplanspage-sync/AIPLANSPAGE_SYNC_PATCH_SPEC.md).
 */

export type ViewTone = "success" | "warning" | "danger" | "neutral" | "info";

// ── Schedule sync state ────────────────────────────────────────────────────────────────────

export type SyncKind = "NOT_SAVED" | "SYNCED" | "UPDATE_AVAILABLE" | "SAVING" | "FAILED";
export type SyncActionId = "save" | "apply" | "retry";

export interface SyncViewModel {
  kind: SyncKind;
  title: string;
  description: string | null;
  tone: ViewTone;
  /** Spinner instead of an action. */
  busy: boolean;
  action: { id: SyncActionId; label: string } | null;
}

export const SYNC_COPY = {
  notSaved: "Lưu vào lịch tập",
  synced: "Lịch tập đang dùng bản mới nhất",
  apply: "Áp dụng bản mới",
  saving: "Đang đồng bộ lịch tập…",
  failed: "Chưa đồng bộ được vào lịch tập",
  retry: "Thử lại",
} as const;

/** A real version number, else null — so copy never prints "vundefined" / "vNaN". */
function validVersion(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

export interface SyncInput {
  /** `undefined` = still loading (card hidden); `null` = no current program. */
  program: { sourcePlanId?: unknown; aiPlanVersion?: unknown } | null | undefined;
  planId: string;
  planVersion: unknown;
  /** This screen's own save request: in flight / just failed for THIS plan. Overrides the server read, which lags by a refetch. */
  saving?: boolean;
  failedMessage?: string | null;
}

/**
 * K9 state table (web spec):
 *  - saving                                            -> spinner
 *  - failed (this plan)                                -> error + "Thử lại"
 *  - no program, or program.sourcePlanId !== plan.id   -> not saved ("Lưu vào lịch tập")
 *  - same plan, (aiPlanVersion ?? 0) >= plan.version   -> synced
 *  - same plan, aiPlanVersion < plan.version           -> update available ("Áp dụng bản mới")
 */
export function deriveSyncState(input: SyncInput): SyncViewModel | null {
  if (input.saving) {
    return { kind: "SAVING", title: SYNC_COPY.saving, description: null, tone: "info", busy: true, action: null };
  }
  if (input.failedMessage) {
    return {
      kind: "FAILED",
      title: SYNC_COPY.failed,
      description: input.failedMessage,
      tone: "danger",
      busy: false,
      action: { id: "retry", label: SYNC_COPY.retry },
    };
  }
  if (input.program === undefined) return null;

  const planVersion = validVersion(input.planVersion) ?? 1;
  const program = input.program;
  if (!program || program.sourcePlanId !== input.planId) {
    return {
      kind: "NOT_SAVED",
      title: "Kế hoạch chưa có trong lịch tập",
      description: "Lưu kế hoạch vào lịch tập để bắt đầu tập theo lịch.",
      tone: "neutral",
      busy: false,
      action: { id: "save", label: SYNC_COPY.notSaved },
    };
  }

  const applied = validVersion(program.aiPlanVersion) ?? 0;
  if (applied >= planVersion) {
    return { kind: "SYNCED", title: SYNC_COPY.synced, description: null, tone: "success", busy: false, action: null };
  }
  return {
    kind: "UPDATE_AVAILABLE",
    title: `Có bản cập nhật mới (v${planVersion}) chưa áp dụng vào lịch tập`,
    description: applied > 0 ? `Lịch tập của bạn đang theo bản v${applied}.` : "Lịch tập của bạn đang theo bản cũ.",
    tone: "warning",
    busy: false,
    action: { id: "apply", label: SYNC_COPY.apply },
  };
}

/** Label of the confirm button inside the save sheet: re-saving a revised plan is an update, not a new save. */
export function saveSheetTitles(kind: SyncKind | null): { title: string; confirm: string } {
  return kind === "UPDATE_AVAILABLE"
    ? { title: "Áp dụng bản mới vào lịch tập", confirm: "Áp dụng vào lịch tập" }
    : { title: "Lưu vào lịch tập", confirm: "Lưu lịch tập" };
}

// ── Save outcome banner (server verdict) ───────────────────────────────────────────────────

export type SaveOutcomeKind = "first_save" | "synced" | "already_current" | "unchanged_content";

export interface SaveResultLike {
  alreadyExists?: boolean;
  contentSynced?: boolean;
  previousAiPlanVersion?: number | null;
}

/**
 * `alreadyExists` is true for EVERY re-save onto an existing program, including the one that just applied a revision — so it alone
 * must never be shown as "đã lưu trước đó" (K9). `contentSynced` / `previousAiPlanVersion` say what really happened.
 */
export function saveOutcomeFrom(result: SaveResultLike, planVersion: unknown): { kind: SaveOutcomeKind; message: string } {
  const v = validVersion(planVersion) ?? 1;
  if (!result.alreadyExists) return { kind: "first_save", message: "Đã lưu kế hoạch vào lịch tập." };
  if (result.contentSynced) {
    return { kind: "synced", message: `Đã cập nhật lịch tập theo phiên bản ${v} của kế hoạch.` };
  }
  if ((result.previousAiPlanVersion ?? 0) >= v) {
    return { kind: "already_current", message: `Lịch tập đã khớp với phiên bản ${v} của kế hoạch — không có gì thay đổi.` };
  }
  return {
    kind: "unchanged_content",
    message: `Phiên bản ${v} không đổi nội dung buổi tập nên lịch tập giữ nguyên (đã ghi nhận theo phiên bản mới).`,
  };
}

// ── AI revision ("Nhờ AI chỉnh kế hoạch") ──────────────────────────────────────────────────

export const REVISION_EXAMPLES = [
  "Tăng từ 4 lên 8 bài mỗi buổi",
  "Giảm còn 3 buổi mỗi tuần",
  "Thay các bài nặng cho đầu gối bằng bài nhẹ hơn",
  "Thêm 10 phút cardio cuối mỗi buổi",
] as const;

/** Same bounds as ai-service's AdjustPlanRequestSchema (adjustments: 5..1000). */
export const REVISION_MIN_LENGTH = 5;
export const REVISION_MAX_LENGTH = 1000;

export const REVISION_MESSAGES = {
  conflict: "Kế hoạch vừa được cập nhật ở nơi khác, hãy tải lại",
  busy: "AI đang chỉnh kế hoạch này, vui lòng đợi",
  rate: "Bạn thao tác quá nhanh, vui lòng đợi một chút rồi thử lại",
  offline: "Không có kết nối mạng. Kiểm tra mạng rồi thử lại — kế hoạch chưa bị thay đổi.",
  unavailable: "AI đang bận hoặc chưa sẵn sàng. Kế hoạch cũ vẫn được giữ nguyên, vui lòng thử lại sau ít phút.",
  server: "Hệ thống đang bận. Vui lòng thử lại sau ít phút.",
  failed: "AI chưa chỉnh được kế hoạch. Kế hoạch cũ vẫn được giữ nguyên.",
  timeout: "AI đang xử lý lâu hơn dự kiến. Kế hoạch hiện tại vẫn được giữ nguyên, hãy mở lại sau ít phút.",
  generic: "Không gửi được yêu cầu. Kế hoạch cũ vẫn được giữ nguyên.",
  revertGeneric: "Không thể quay lại bản trước. Vui lòng thử lại.",
  needsText: "Hãy mô tả bạn muốn đổi gì trong kế hoạch.",
} as const;

export function validateInstruction(text: string): string | null {
  const t = text.trim();
  if (t.length < REVISION_MIN_LENGTH) return REVISION_MESSAGES.needsText;
  if (t.length > REVISION_MAX_LENGTH) return `Yêu cầu tối đa ${REVISION_MAX_LENGTH} ký tự.`;
  return null;
}

export type RevisionErrorKind =
  | "conflict" // plan moved elsewhere -> refetch
  | "busy" // another revision is running
  | "clarify" // the server asks a question back
  | "rate"
  | "offline"
  | "unavailable"
  | "invalid"
  | "other";

export interface RevisionError {
  kind: RevisionErrorKind;
  message: string;
  /** Refetch the plan (it is no longer what the user was looking at). */
  reload: boolean;
}

interface ErrorLike {
  response?: { status?: number; data?: unknown };
}

function errorParts(error: unknown): { status: number | null; code: string | null; message: string | null; hasResponse: boolean } {
  const res = (error as ErrorLike | null)?.response;
  if (!res) return { status: null, code: null, message: null, hasResponse: false };
  const data = res.data as { error?: unknown; code?: unknown; message?: unknown } | undefined;
  const nested = data && typeof data.error === "object" && data.error !== null ? (data.error as { code?: unknown; message?: unknown }) : null;
  const code = typeof nested?.code === "string" ? nested.code : typeof data?.code === "string" ? data.code : null;
  const message =
    typeof nested?.message === "string" ? nested.message : typeof data?.error === "string" ? data.error : typeof data?.message === "string" ? data.message : null;
  return { status: typeof res.status === "number" ? res.status : null, code, message, hasResponse: true };
}

/** Server error of `POST /plans/adjust` -> a sentence a person can act on. Never a raw code. */
export function mapRevisionError(error: unknown): RevisionError {
  const { status, code, message, hasResponse } = errorParts(error);
  if (!hasResponse) return { kind: "offline", message: REVISION_MESSAGES.offline, reload: false };
  if (code === "VERSION_CONFLICT") return { kind: "conflict", message: REVISION_MESSAGES.conflict, reload: true };
  if (code === "REVISION_IN_PROGRESS") return { kind: "busy", message: REVISION_MESSAGES.busy, reload: false };
  if (code === "NEEDS_CLARIFICATION" && message) return { kind: "clarify", message, reload: false };
  if (status === 429 || code === "RATE_LIMITED") return { kind: "rate", message: REVISION_MESSAGES.rate, reload: false };
  if (status === 422 && message) return { kind: "invalid", message, reload: false };
  if (status === 400) return { kind: "invalid", message: REVISION_MESSAGES.needsText, reload: false };
  if (status === 502 || status === 503 || status === 504) return { kind: "unavailable", message: REVISION_MESSAGES.unavailable, reload: false };
  if (status !== null && status >= 500) return { kind: "other", message: REVISION_MESSAGES.server, reload: false };
  if (message) return { kind: "other", message, reload: false };
  return { kind: "other", message: REVISION_MESSAGES.generic, reload: false };
}

/** Server error of `POST /plans/:id/revert`. */
export function mapRevertError(error: unknown): RevisionError {
  const { status, code, message, hasResponse } = errorParts(error);
  if (!hasResponse) return { kind: "offline", message: REVISION_MESSAGES.offline, reload: false };
  if (code === "VERSION_CONFLICT") return { kind: "conflict", message: REVISION_MESSAGES.conflict, reload: true };
  if (code === "REVISION_IN_PROGRESS") return { kind: "busy", message: REVISION_MESSAGES.busy, reload: false };
  if (status !== null && status >= 500) return { kind: "other", message: REVISION_MESSAGES.server, reload: false };
  // 409 "đang được đăng trên chợ", "không có phiên bản trước"… — the server's Vietnamese sentence is the explanation.
  return { kind: "other", message: message ?? REVISION_MESSAGES.revertGeneric, reload: false };
}

function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** One id per open sheet. */
export function newSheetId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Stable per open sheet + request text + the plan version looked at: a double tap or a retry of the same text after a lost response
 * is the same operation server-side; a different text or a newer plan version is a new one.
 * Charset/length accepted by the server: [A-Za-z0-9._:-]{8,128}.
 */
export function buildIdempotencyKey(sheetId: string, instruction: string, planVersion: number): string {
  return `rev-${sheetId}-v${planVersion}-${hash(instruction.trim().replace(/\s+/g, " ").toLowerCase())}`;
}

/**
 * After a definitive server answer (4xx / 500) the next attempt is a NEW action; no answer (timeout, offline) or a gateway status that
 * does not say whether the server got it (408/502/503/504) keeps the key — same rule as wizard.tsx.
 */
export function keepKeyAfterError(error: unknown): boolean {
  const { status, hasResponse } = errorParts(error);
  if (!hasResponse) return true;
  return status !== null && [408, 502, 503, 504].includes(status);
}

/**
 * Same condition as web (AIPlansPage "Quay lại bản trước"): a COMPLETED plan that records the plan it was adjusted from
 * (`plan._metadata.revision.previousPlanId`; for an in-place revision that is the plan's own id).
 */
export function canRevertPlan(plan: { status?: unknown; plan?: unknown } | null | undefined): boolean {
  if (!plan || plan.status !== "COMPLETED") return false;
  const id = (plan.plan as { _metadata?: { revision?: { previousPlanId?: unknown } } } | null | undefined)?._metadata?.revision?.previousPlanId;
  return typeof id === "string" && id.length > 0;
}

export const REVERT_CONFIRM = {
  title: "Khôi phục bản trước?",
  body: "Quay lại phiên bản trước khi điều chỉnh? Nội dung bản đang xem sẽ được thay bằng bản trước đó.",
  confirm: "Khôi phục bản trước",
  cancel: "Giữ bản hiện tại",
  done: "Đã quay lại phiên bản kế hoạch trước",
} as const;

// ── PT approval hint ───────────────────────────────────────────────────────────────────────

export const PT_OUTDATED_HINT = "PT đã duyệt bản cũ — mở Lịch tập để gửi lại";

/**
 * Only the partner's PlanReviewCard (program screen) can re-send for approval. This screen just points to it, and only when the
 * server says the approval of the program built from THIS plan no longer applies.
 */
export function showPtOutdatedHint(
  program: { sourcePlanId?: unknown } | null | undefined,
  planId: string,
  latestReview: { effectiveState?: unknown } | null | undefined,
): boolean {
  return !!program && program.sourcePlanId === planId && latestReview?.effectiveState === "APPROVED_OUTDATED";
}
