import { api } from "../../services/api";
import type { PlanReviewItem } from "./planReview";

/**
 * /plan-reviews (fitness-service, through the gateway). Identity and role are NEVER sent in a body — the server takes them from the
 * session — so nothing here can name a client or a PT other than the one the user picked from their own active contracts.
 */
export const planReviewApi = {
  submit: async (input: { ptUserId: string; clientNote?: string; expectedVersion?: number; idempotencyKey: string }) => {
    const { idempotencyKey, ...body } = input;
    const { data } = await api.post("/plan-reviews", body, { headers: { "Idempotency-Key": idempotencyKey } });
    return data as { request: PlanReviewItem; replayed: boolean };
  },
  mine: async (programId?: string) => {
    const { data } = await api.get("/plan-reviews/mine", { params: programId ? { programId } : undefined });
    return (data?.requests ?? []) as PlanReviewItem[];
  },
  inbox: async () => {
    const { data } = await api.get("/plan-reviews/inbox");
    return (data?.requests ?? []) as PlanReviewItem[];
  },
  get: async (id: string) => {
    const { data } = await api.get(`/plan-reviews/${id}`);
    return data.request as PlanReviewItem;
  },
  start: async (id: string) => {
    const { data } = await api.post(`/plan-reviews/${id}/start`);
    return data.request as PlanReviewItem;
  },
  decide: async (
    id: string,
    input: { decision: "APPROVE" | "REQUEST_CHANGES" | "REJECT"; note?: string; expectedRevision: number; expectedContentHash: string },
  ) => {
    const { data } = await api.post(`/plan-reviews/${id}/decision`, input);
    return data as { request: PlanReviewItem; replayed: boolean };
  },
  cancel: async (id: string) => {
    const { data } = await api.post(`/plan-reviews/${id}/cancel`);
    return data as { request: PlanReviewItem; replayed: boolean };
  },
};
