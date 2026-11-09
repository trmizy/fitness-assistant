/**
 * Header of the Tài chính workspace (approved by Ngài 28/10): the page title follows the active level-2 tab and the
 * header "Làm mới" re-reads exactly that tab's queries. Pure — runs under `npx tsx --test`.
 */
import type { QueryKey } from "@tanstack/react-query";

export type FinanceTabKey = "overview" | "reconciliation" | "withdrawals" | "refunds";

export interface FinanceTabLike {
  key: FinanceTabKey;
  to: string;
  end?: boolean;
}

/** What the H1 says per tab. Overview is spelled out ("Tổng quan tài chính"); the others are their tab names. */
export const FINANCE_TITLE: Record<FinanceTabKey, string> = {
  overview: "Tổng quan tài chính",
  reconciliation: "Đối soát",
  withdrawals: "Rút tiền",
  refunds: "Hoàn tiền",
};
export const FINANCE_FALLBACK_TITLE = "Tài chính";

/** Same matching rule as the tab strip: `end` tabs match exactly, others match themselves and children. */
export function activeFinanceTab<T extends FinanceTabLike>(tabs: readonly T[], pathname: string): T | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  return tabs.find((t) => (t.end ? path === t.to : path === t.to || path.startsWith(`${t.to}/`))) ?? null;
}

export function financeTitle(tab: FinanceTabKey | null): string {
  return tab ? FINANCE_TITLE[tab] : FINANCE_FALLBACK_TITLE;
}

/**
 * Query-key PREFIXES each tab reads (TanStack matches by prefix). Overview additionally shows the finance queues, so it
 * re-reads those too; Đối soát = everything under ["admin","finance"] (balance, obligations, sessions, P2).
 */
export const FINANCE_REFRESH_KEYS: Record<FinanceTabKey, readonly QueryKey[]> = {
  overview: [["admin", "finance"], ["admin", "finance-overview"], ["admin", "pending-withdrawals"], ["refund-requests"]],
  reconciliation: [["admin", "finance"]],
  withdrawals: [["admin", "pending-withdrawals"]],
  refunds: [["refund-requests"], ["refund-calculation"]],
};

export function financeRefreshKeys(tab: FinanceTabKey | null): readonly QueryKey[] {
  return tab ? FINANCE_REFRESH_KEYS[tab] : [];
}

/** Does a cached query key start with the given prefix? (for `useIsFetching`'s predicate) */
export function keyHasPrefix(queryKey: readonly unknown[], prefix: readonly unknown[]): boolean {
  if (prefix.length > queryKey.length) return false;
  return prefix.every((p, i) => queryKey[i] === p);
}

export function keyMatchesAny(queryKey: readonly unknown[], prefixes: readonly QueryKey[]): boolean {
  return prefixes.some((p) => keyHasPrefix(queryKey, p as readonly unknown[]));
}
