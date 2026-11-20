/**
 * Workout Plan Review & Approval — the pure parts shared by the client card and the PT inbox on mobile.
 *
 * The backend (fitness-service, /plan-reviews) is the single source of truth for every state shown here; nothing in this file decides
 * a review outcome. It only (a) names states for people, (b) maps a server error to a Vietnamese sentence, (c) shapes the stored plan
 * snapshot for display, and (d) answers "may this action be offered?" so the UI never offers something the server will refuse.
 * Same contract as web's planReviewApi.ts — web and mobile always show the same state because both read the server.
 */

export type PlanReviewStatus =
  | "PENDING_REVIEW"
  | "IN_REVIEW"
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "REJECTED"
  | "CANCELLED"
  | "SUPERSEDED"
  | "ACCESS_REVOKED";

export type PlanReviewEffectiveState = "APPROVED_CURRENT" | "APPROVED_OUTDATED" | "OPEN" | "CHANGES_REQUESTED" | "REJECTED" | "NONE";

export interface PlanReviewItem {
  id: string;
  subjectId: string;
  subjectVersion: number;
  contentHash: string;
  status: PlanReviewStatus;
  revision: number;
  clientNote: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  submittedAt: string;
  effectiveState: PlanReviewEffectiveState;
  /** The plan changed (version or content) after this request was submitted. */
  isOutdated: boolean;
  snapshot?: unknown;
}

export type BadgeToneName = "success" | "warning" | "danger" | "neutral" | "info";

export const STATUS_META: Record<PlanReviewStatus, { label: string; tone: BadgeToneName }> = {
  PENDING_REVIEW: { label: "Đang chờ PT duyệt", tone: "warning" },
  IN_REVIEW: { label: "PT đang xem xét", tone: "info" },
  APPROVED: { label: "PT đã duyệt", tone: "success" },
  CHANGES_REQUESTED: { label: "PT yêu cầu chỉnh sửa", tone: "warning" },
  REJECTED: { label: "PT đã từ chối", tone: "danger" },
  CANCELLED: { label: "Đã huỷ", tone: "neutral" },
  SUPERSEDED: { label: "Đã được thay bằng bản mới", tone: "neutral" },
  ACCESS_REVOKED: { label: "Hợp đồng PT đã kết thúc", tone: "neutral" },
};

export const isOpenStatus = (s: PlanReviewStatus): boolean => s === "PENDING_REVIEW" || s === "IN_REVIEW";

/** What the client sees as the label: an approval that no longer applies must NOT read as "approved". */
export function clientStatusLabel(item: Pick<PlanReviewItem, "status" | "effectiveState">): { label: string; tone: BadgeToneName } {
  if (item.status === "APPROVED" && item.effectiveState === "APPROVED_OUTDATED") {
    return { label: "Đã duyệt bản cũ — cần gửi lại", tone: "warning" };
  }
  return STATUS_META[item.status];
}

/** A note is mandatory when asking for changes or rejecting (the server enforces it too). */
export const NOTE_MIN_FOR_NEGATIVE = 3;
export const NOTE_MAX = 1000;
export const canSendNegativeDecision = (note: string): boolean => note.trim().length >= NOTE_MIN_FOR_NEGATIVE && note.length <= NOTE_MAX;

/** Client may (re)submit when there is no open request. An open one is cancelled first (never two open requests per plan). */
export function clientAction(latest: Pick<PlanReviewItem, "status"> | undefined): "SUBMIT" | "RESUBMIT" | "CANCEL" {
  if (!latest) return "SUBMIT";
  return isOpenStatus(latest.status) ? "CANCEL" : "RESUBMIT";
}

/** PT may decide only on an open request. */
export const ptCanDecide = (item: Pick<PlanReviewItem, "status">): boolean => isOpenStatus(item.status);

/**
 * One idempotency key per CONFIRMED attempt: a double tap or a retry after a lost response re-sends the SAME key and the server
 * returns the same request. Hermes does not guarantee crypto.randomUUID, hence the fallback.
 */
export function newIdempotencyKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const rnd = () => Math.random().toString(36).slice(2, 10);
  return `k-${Date.now().toString(36)}-${rnd()}${rnd()}`;
}

/** Server error -> sentence a person can act on. Never a raw code, enum or stack. */
export function planReviewErrorMessage(error: unknown): string {
  const e = error as { response?: { status?: number; data?: { code?: string; error?: string } }; message?: string } | null;
  if (!e || !e.response) return "Không có kết nối mạng. Kiểm tra mạng rồi thử lại — yêu cầu chưa được gửi.";
  const status = e.response.status;
  if (status === 401) return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
  switch (e.response.data?.code) {
    case "NO_ACTIVE_CONTRACT": return "Bạn không có hợp đồng PT còn hiệu lực để thực hiện thao tác này.";
    case "STALE_REVISION":
    case "REVISION_OUTDATED": return "Kế hoạch đã thay đổi so với bản được gửi. Hãy tải lại và gửi lại bản mới nhất.";
    case "CONCURRENT_MODIFICATION": return "Yêu cầu vừa được cập nhật ở nơi khác. Hãy kéo xuống để tải lại.";
    case "OPEN_REQUEST_WITH_OTHER_PT": return "Bạn đang có yêu cầu chờ duyệt với PT khác. Hãy huỷ yêu cầu đó trước.";
    case "AUTH_DEPENDENCY_UNAVAILABLE": return "Chưa xác minh được hợp đồng PT lúc này. Vui lòng thử lại sau ít phút.";
    case "NO_CURRENT_PROGRAM": return "Bạn chưa có kế hoạch tập luyện hiện tại để gửi.";
    case "NOTE_REQUIRED": return "Vui lòng ghi rõ lý do hoặc nội dung cần chỉnh sửa.";
    default:
      if (status && status >= 500) return "Hệ thống đang bận. Vui lòng thử lại sau ít phút.";
      return e.response.data?.error || "Có lỗi xảy ra. Vui lòng thử lại.";
  }
}

export interface SnapshotExercise { name: string; detail: string }
export interface SnapshotDay { dayNumber: number; title: string; exercises: SnapshotExercise[] }

/** The stored snapshot is server data of a known shape, but a missing field must degrade to a dash, never crash the screen. */
export function snapshotDays(snapshot: unknown): SnapshotDay[] {
  const days = (snapshot as { days?: unknown } | null)?.days;
  if (!Array.isArray(days)) return [];
  return days.map((d: any, i: number) => ({
    dayNumber: Number.isFinite(d?.dayNumber) ? Number(d.dayNumber) : i + 1,
    title: typeof d?.title === "string" && d.title.trim() ? d.title : `Buổi ${i + 1}`,
    exercises: (Array.isArray(d?.exercises) ? d.exercises : []).map((ex: any) => {
      const sets = ex?.sets ?? "—";
      const reps = ex?.reps ?? ex?.duration ?? "—";
      const rest = ex?.restSeconds ? ` · nghỉ ${ex.restSeconds}s` : "";
      return { name: typeof ex?.name === "string" && ex.name ? ex.name : "Bài tập", detail: `${sets} hiệp × ${reps}${rest}` };
    }),
  }));
}

export const snapshotTitle = (snapshot: unknown): string => {
  const name = (snapshot as { name?: unknown } | null)?.name;
  return typeof name === "string" && name.trim() ? name : "Kế hoạch tập luyện";
};
