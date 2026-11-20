import { api } from "./api";

/**
 * Workout Plan Review & Approval client (fitness-service, mounted at /plan-reviews).
 * The backend is the single source of truth: nothing here is cached beyond React Query, and every state shown comes from a server
 * response. Identity/role are never sent in a body — the server derives them from the session.
 */

export type PlanReviewStatus =
  | "PENDING_REVIEW" | "IN_REVIEW" | "APPROVED" | "CHANGES_REQUESTED" | "REJECTED" | "CANCELLED" | "SUPERSEDED" | "ACCESS_REVOKED";
export type PlanReviewEffectiveState = "APPROVED_CURRENT" | "APPROVED_OUTDATED" | "OPEN" | "CHANGES_REQUESTED" | "REJECTED" | "NONE";

export interface PlanReviewItem {
  id: string;
  clientUserId: string;
  ptUserId: string;
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
  /** The plan changed after this request was submitted (revision mismatch warning). */
  isOutdated: boolean;
  snapshot?: any;
}

export interface PlanReviewEvent {
  id: string;
  type: string;
  actorRole: "CLIENT" | "PT" | "SYSTEM";
  toStatus: PlanReviewStatus;
  note: string | null;
  createdAt: string;
}

/** Stable per-attempt key so a double click / flaky retry / second device cannot create two requests. */
export function newIdempotencyKey(): string {
  const c = (globalThis as any).crypto;
  return c?.randomUUID ? c.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Maps a backend error to a Vietnamese, user-facing message (never a raw enum/stack). */
export function planReviewErrorMessage(error: any): string {
  if (!error?.response) return "Không có kết nối mạng. Vui lòng kiểm tra và thử lại — yêu cầu chưa được gửi.";
  const code = error.response.data?.code as string | undefined;
  switch (code) {
    case "NO_ACTIVE_CONTRACT": return "Bạn không có hợp đồng PT còn hiệu lực để thực hiện thao tác này.";
    case "STALE_REVISION":
    case "REVISION_OUTDATED": return "Kế hoạch đã thay đổi so với bản được gửi. Hãy tải lại và gửi lại bản mới nhất.";
    case "CONCURRENT_MODIFICATION": return "Yêu cầu vừa được cập nhật ở nơi khác. Hãy tải lại.";
    case "OPEN_REQUEST_WITH_OTHER_PT": return "Bạn đang có yêu cầu chờ duyệt với PT khác. Hãy huỷ yêu cầu đó trước.";
    case "AUTH_DEPENDENCY_UNAVAILABLE": return "Chưa xác minh được hợp đồng PT lúc này. Vui lòng thử lại sau ít phút.";
    case "NO_CURRENT_PROGRAM": return "Bạn chưa có kế hoạch tập luyện hiện tại để gửi.";
    case "NOTE_REQUIRED": return "Vui lòng ghi rõ lý do hoặc nội dung cần chỉnh sửa.";
    default: return error.response.data?.error ?? "Có lỗi xảy ra. Vui lòng thử lại.";
  }
}

export const planReviewService = {
  submit: async (input: { ptUserId: string; clientNote?: string; expectedContentHash?: string; idempotencyKey: string }) => {
    const { idempotencyKey, ...body } = input;
    const { data } = await api.post("/plan-reviews", body, { headers: { "Idempotency-Key": idempotencyKey } });
    return data as { request: PlanReviewItem; replayed: boolean };
  },
  mine: async (programId?: string) => {
    const { data } = await api.get("/plan-reviews/mine", { params: programId ? { programId } : undefined });
    return data.requests as PlanReviewItem[];
  },
  inbox: async (statuses?: PlanReviewStatus[]) => {
    const { data } = await api.get("/plan-reviews/inbox", { params: statuses ? { status: statuses.join(",") } : undefined });
    return data.requests as PlanReviewItem[];
  },
  summary: async () => (await api.get("/plan-reviews/summary")).data,
  get: async (id: string) => (await api.get(`/plan-reviews/${id}`)).data.request as PlanReviewItem,
  events: async (id: string) => (await api.get(`/plan-reviews/${id}/events`)).data.events as PlanReviewEvent[],
  start: async (id: string) => (await api.post(`/plan-reviews/${id}/start`)).data.request as PlanReviewItem,
  decide: async (id: string, input: { decision: "APPROVE" | "REQUEST_CHANGES" | "REJECT"; note?: string; expectedRevision?: number; expectedContentHash?: string }) =>
    (await api.post(`/plan-reviews/${id}/decision`, input)).data as { request: PlanReviewItem; replayed: boolean },
  cancel: async (id: string) => (await api.post(`/plan-reviews/${id}/cancel`)).data as { request: PlanReviewItem; replayed: boolean },
};
