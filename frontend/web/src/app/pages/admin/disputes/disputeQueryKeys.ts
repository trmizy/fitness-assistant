/**
 * Dispute V2.1 admin UI (D1) - React Query keys.
 *
 * Every key starts with `["dispute-case", userId, ...]` (gymini-account-session-isolation): data of one account can never be
 * served to another, even if a cache clear were missed. The app already calls `queryClient.clear()` on logout / login / session expiry
 * (context/AppContext.tsx); the user id in the key is the second lock.
 *
 * NO POLLING: every list read (A2, B1) and every detail read (A3, B2) writes an access-log row per case/evidence returned, so a
 * refetch interval, refetch-on-focus or automatic retry would write logs nobody asked for. Reload is always a user click.
 */
import { useMemo } from "react";
import { useApp } from "../../../context/AppContext";
import type { CaseStatus } from "./disputeCaseTypes";

export const DISPUTE_QUERY_ROOT = "dispute-case" as const;

export interface DisputeListFilter {
  status?: CaseStatus;
  limit?: number;
  offset?: number;
}

/** Pure factory: `userId` is required and never defaulted, so a key without an owner cannot exist. */
export function disputeQueryKeys(userId: string) {
  if (!userId) throw new Error("disputeQueryKeys needs the signed-in user id");
  const base = [DISPUTE_QUERY_ROOT, userId] as const;
  return {
    /** Prefix of everything of this user (for invalidation after a write). */
    all: base,
    list: (filter: DisputeListFilter = {}) => [...base, "list", { status: filter.status ?? null, limit: filter.limit ?? 50, offset: filter.offset ?? 0 }] as const,
    detail: (caseId: string) => [...base, "detail", caseId] as const,
    disputedSessions: () => [...base, "disputed-sessions"] as const,
    partyList: () => [...base, "party-list"] as const,
    partyDetail: (caseId: string) => [...base, "party-detail", caseId] as const,
  };
}
export type DisputeQueryKeys = ReturnType<typeof disputeQueryKeys>;

/**
 * Options to spread into every dispute `useQuery`: no interval, no focus/reconnect refetch, no automatic retry.
 * (Typed loosely on purpose: a plain object works for every React Query v5 `useQuery`.)
 */
export const DISPUTE_QUERY_OPTIONS = {
  refetchInterval: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  refetchOnMount: true,
  retry: false,
  staleTime: 0,
} as const;

/** Keys of the signed-in user, or `null` while nobody is signed in (then the query must stay `enabled: false`). */
export function useDisputeQueryKeys(): { keys: DisputeQueryKeys | null; userId: string | null } {
  const { user } = useApp();
  const userId = user?.id ?? null;
  return useMemo(() => ({ keys: userId ? disputeQueryKeys(userId) : null, userId }), [userId]);
}
