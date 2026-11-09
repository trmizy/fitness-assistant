/**
 * D6 - React Query keys for the gym complaint surfaces. Every key starts with `["gym-complaint", userId, ...]`
 * (gymini-account-session-isolation): data of one account can never be served to another even if a cache clear were missed.
 * The app already calls `queryClient.clear()` on logout / login / session expiry (context/AppContext.tsx); the user id in the key is the second lock.
 *
 * NO POLLING: every list/detail read writes access-log rows on the server (VIEW_CASE / VIEW_EVIDENCE), so there is no refetch interval,
 * no refetch on focus/reconnect and no automatic retry. Reload is always a user click.
 */
import { useMemo } from "react";
import { useApp } from "../../../context/AppContext";
import type { GymCaseStatus } from "./gymCaseTypes";

export const GYM_QUERY_ROOT = "gym-complaint" as const;

export function gymQueryKeys(userId: string) {
  if (!userId) throw new Error("gymQueryKeys needs the signed-in user id");
  const base = [GYM_QUERY_ROOT, userId] as const;
  return {
    all: base,
    complaints: (f: { status?: string; page?: number }) => [...base, "complaints", { status: f.status ?? null, page: f.page ?? 0 }] as const,
    complaintsAll: () => [...base, "complaints"] as const,
    gyms: () => [...base, "gyms"] as const,
    adminOptions: () => [...base, "admin-options"] as const,
    capabilities: () => [...base, "capabilities"] as const,
    caseList: (f: { status?: GymCaseStatus; page?: number }) => [...base, "case-list", { status: f.status ?? null, page: f.page ?? 0 }] as const,
    caseListAll: () => [...base, "case-list"] as const,
    detail: (caseId: string) => [...base, "detail", caseId] as const,
    history: (caseId: string, page: number) => [...base, "history", caseId, page] as const,
    caseByComplaint: (complaintId: string) => [...base, "case-by-complaint", complaintId] as const,
    membershipOptions: (complaintId: string) => [...base, "membership-options", complaintId] as const,
    myList: () => [...base, "my-list"] as const,
    myDetail: (caseId: string) => [...base, "my-detail", caseId] as const,
  };
}
export type GymQueryKeys = ReturnType<typeof gymQueryKeys>;

export const GYM_QUERY_OPTIONS = {
  refetchInterval: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  refetchOnMount: true,
  retry: false,
  staleTime: 0,
} as const;

export function useGymQueryKeys(): { keys: GymQueryKeys | null; userId: string | null } {
  const { user } = useApp();
  const userId = user?.id ?? null;
  return useMemo(() => ({ keys: userId ? gymQueryKeys(userId) : null, userId }), [userId]);
}
