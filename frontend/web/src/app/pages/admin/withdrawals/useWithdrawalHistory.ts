import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "../../../context/AppContext";
import { historyKey, toHistoryQuery, withdrawalHistoryApi, type HistoryStatus } from "./withdrawalHistory";

/**
 * G-08 — history of one tab / page. The key starts with the queue's own prefix (so "Làm mới" and every approve / pay /
 * reject refresh it) and carries the signed-in user id (gymini-account-session-isolation). Read only: no polling, no
 * refetch on focus / reconnect, no automatic retry — reloading is always a click.
 */
export function useWithdrawalHistory(status: HistoryStatus, page: number) {
  const { user } = useApp();
  const userId = user?.id ?? null;
  const query = useMemo(() => toHistoryQuery(status, page), [status, page]);
  return useQuery({
    queryKey: userId ? historyKey(userId, query) : ["admin", "pending-withdrawals", "history", "none"],
    enabled: !!userId,
    queryFn: () => withdrawalHistoryApi.listHistory(query),
    // Keep the rows on screen (dimmed) while the NEXT PAGE of the same tab loads; never show one tab's rows under another.
    // Key layout: [admin, pending-withdrawals, history, userId, status, limit, offset] → index 4 is the status.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[4] === status ? previous : undefined),
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    staleTime: 30_000,
  });
}
