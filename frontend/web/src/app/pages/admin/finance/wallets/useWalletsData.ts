import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useApp } from "../../../../context/AppContext";
import { getWallet, listWallets, toDetailQuery, toListQuery, type ListWalletsQuery, type WalletDetailQuery } from "./walletsApi";
import type { WalletFilters } from "./walletsUrlState";

/**
 * G-09 — React Query keys of "Tài chính › Ví". Every key is `["admin","finance-wallets", userId, ...]`
 * (gymini-account-session-isolation): one account's rows can never be served to another even if a cache clear were missed.
 * The header "Làm mới" invalidates the `["admin","finance-wallets"]` prefix.
 */
export const WALLET_ROOT = ["admin", "finance-wallets"] as const;

export function walletKeys(userId: string) {
  if (!userId) throw new Error("walletKeys needs the signed-in user id");
  const base = [...WALLET_ROOT, userId] as const;
  return {
    all: base,
    list: (query: ListWalletsQuery) => [...base, "list", query] as const,
    detail: (id: string, query: WalletDetailQuery) => [...base, "detail", id, query] as const,
  };
}
export type WalletKeys = ReturnType<typeof walletKeys>;

/** Read-only screen: no polling, no refetch on focus / reconnect, no automatic retry. Reload is always a click. */
export const WALLET_QUERY_OPTIONS = {
  refetchInterval: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  retry: false,
  staleTime: 30_000,
} as const;

function useWalletKeys(): WalletKeys | null {
  const { user } = useApp();
  const userId = user?.id ?? null;
  return useMemo(() => (userId ? walletKeys(userId) : null), [userId]);
}

const NONE = ["admin", "finance-wallets", "none"] as const;

export function useWalletList(filters: WalletFilters) {
  const keys = useWalletKeys();
  const query = useMemo(() => toListQuery(filters), [filters]);
  return useQuery({
    queryKey: keys ? keys.list(query) : [...NONE, "list"],
    enabled: !!keys,
    queryFn: () => listWallets(query),
    // Keep the rows on screen (dimmed) while a new filter / page loads instead of flashing an empty table.
    placeholderData: keepPreviousData,
    ...WALLET_QUERY_OPTIONS,
  });
}

export function useWalletDetail(id: string | null, entriesPage: number) {
  const keys = useWalletKeys();
  const query = useMemo(() => toDetailQuery(entriesPage), [entriesPage]);
  return useQuery({
    queryKey: keys && id ? keys.detail(id, query) : [...NONE, "detail"],
    enabled: !!keys && !!id,
    queryFn: () => getWallet(id as string, query),
    // Paging the entries keeps the previous page on screen (dimmed) — but only for the same wallet.
    placeholderData: (prev, prevQuery) => (prevQuery && (prevQuery.queryKey as readonly unknown[])[4] === id ? prev : undefined),
    ...WALLET_QUERY_OPTIONS,
  });
}
