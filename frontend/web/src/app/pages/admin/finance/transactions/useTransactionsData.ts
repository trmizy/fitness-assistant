import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useApp } from "../../../../context/AppContext";
import { getTransaction, listTransactions, toListQuery, type ListTransactionsQuery } from "./transactionsApi";
import type { TransactionFilters } from "./transactionsUrlState";

/**
 * B7 — React Query keys of "Tài chính › Giao dịch". Every key is `["admin","finance-transactions", userId, ...]`
 * (gymini-account-session-isolation): one account's rows can never be served to another even if a cache clear were missed
 * (the app also clears the cache on logout / login). The header "Làm mới" invalidates the `["admin","finance-transactions"]` prefix.
 */
export const TXN_ROOT = ["admin", "finance-transactions"] as const;

export function txnKeys(userId: string) {
  if (!userId) throw new Error("txnKeys needs the signed-in user id");
  const base = [...TXN_ROOT, userId] as const;
  return {
    all: base,
    list: (query: ListTransactionsQuery) => [...base, "list", query] as const,
    detail: (id: string) => [...base, "detail", id] as const,
  };
}
export type TxnKeys = ReturnType<typeof txnKeys>;

/** Read-only screen: no polling, no refetch on focus / reconnect, no automatic retry. Reload is always a click. */
export const TXN_QUERY_OPTIONS = {
  refetchInterval: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  retry: false,
  staleTime: 30_000,
} as const;

function useTxnKeys(): TxnKeys | null {
  const { user } = useApp();
  const userId = user?.id ?? null;
  return useMemo(() => (userId ? txnKeys(userId) : null), [userId]);
}

const NONE = ["admin", "finance-transactions", "none"] as const;

export function useTransactionList(filters: TransactionFilters) {
  const keys = useTxnKeys();
  const query = useMemo(() => toListQuery(filters), [filters]);
  return useQuery({
    queryKey: keys ? keys.list(query) : [...NONE, "list"],
    enabled: !!keys,
    queryFn: () => listTransactions(query),
    // Keep the rows on screen (dimmed) while a new filter / page loads instead of flashing an empty table.
    placeholderData: keepPreviousData,
    ...TXN_QUERY_OPTIONS,
  });
}

export function useTransactionDetail(id: string | null) {
  const keys = useTxnKeys();
  return useQuery({
    queryKey: keys && id ? keys.detail(id) : [...NONE, "detail"],
    enabled: !!keys && !!id,
    queryFn: () => getTransaction(id as string),
    ...TXN_QUERY_OPTIONS,
  });
}
