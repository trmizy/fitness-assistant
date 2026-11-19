import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "../../../../context/AppContext";
import type { DayRange } from "./gatewayReconciliationModel";
import { vnpayL3Api } from "./vnpayL3Api";
import { l3RangeProblem } from "./vnpayL3Model";

/**
 * B8 L3 — React Query key of "Đối chiếu trực tiếp với VNPay". `["admin","vnpay-l3", userId, from, to]`.
 *  - It is deliberately NOT under ["admin","finance"]: the finance header's "Làm mới" invalidates that prefix, and L3 must never ask VNPay
 *    again because of an unrelated refresh. Asking VNPay is always a click on "Hỏi VNPay".
 *  - It carries the signed-in user id (gymini-account-session-isolation); the app also clears the cache on logout / login.
 *  - On demand only: `enabled` stays false until the first click; no polling, no refetch on focus / reconnect, no retry.
 */
export const L3_ROOT = ["admin", "vnpay-l3"] as const;

export function l3Keys(userId: string) {
  if (!userId) throw new Error("l3Keys needs the signed-in user id");
  const base = [...L3_ROOT, userId] as const;
  return { all: base, report: (range: DayRange) => [...base, range.from, range.to] as const };
}

export const L3_QUERY_OPTIONS = {
  refetchInterval: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  retry: false,
  staleTime: Infinity,
} as const;

export function useVnpayL3() {
  const { user } = useApp();
  const userId = user?.id ?? null;
  const keys = useMemo(() => (userId ? l3Keys(userId) : null), [userId]);
  // The range that was actually asked: the query is enabled only once this is set (by a click), never by typing in the date inputs.
  const [asked, setAsked] = useState<DayRange | null>(null);
  const q = useQuery({
    queryKey: keys && asked ? keys.report(asked) : [...L3_ROOT, "none"],
    enabled: !!keys && asked !== null && l3RangeProblem(asked) === null,
    queryFn: () => vnpayL3Api.getReport(asked as DayRange),
    ...L3_QUERY_OPTIONS,
  });
  const ask = useCallback(
    (range: DayRange) => {
      if (l3RangeProblem(range) !== null) return;
      if (asked && asked.from === range.from && asked.to === range.to) void q.refetch();
      else setAsked({ from: range.from, to: range.to });
    },
    [asked, q],
  );
  return { query: q, asked, ask };
}
