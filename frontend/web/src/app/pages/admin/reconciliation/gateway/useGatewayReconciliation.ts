import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "../../../../context/AppContext";
import { gatewayReconciliationApi } from "./gatewayReconciliationApi";
import { rangeProblem, type DayRange } from "./gatewayReconciliationModel";

/**
 * B8 — React Query key of "Đối chiếu cổng ↔ Gymini". `["admin","finance","gateway-reconciliation", userId, from, to]`: under the "Tài chính"
 * prefix (the header "Làm mới" re-reads it) and carrying the signed-in user id (gymini-account-session-isolation: one account's figures can
 * never be served to the next, even if a cache clear were missed; the app also clears the cache on logout / login).
 * Read-only: no polling, no refetch on focus / reconnect, no automatic retry — reloading is always a click.
 */
export const GATEWAY_RECON_ROOT = ["admin", "finance", "gateway-reconciliation"] as const;

export function gatewayReconKeys(userId: string) {
  if (!userId) throw new Error("gatewayReconKeys needs the signed-in user id");
  const base = [...GATEWAY_RECON_ROOT, userId] as const;
  return { all: base, report: (range: DayRange) => [...base, range.from, range.to] as const };
}

export const GATEWAY_QUERY_OPTIONS = {
  refetchInterval: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  retry: false,
  staleTime: 30_000,
} as const;

export function useGatewayReconciliation(range: DayRange) {
  const { user } = useApp();
  const userId = user?.id ?? null;
  const keys = useMemo(() => (userId ? gatewayReconKeys(userId) : null), [userId]);
  return useQuery({
    queryKey: keys ? keys.report(range) : [...GATEWAY_RECON_ROOT, "none", range.from, range.to],
    // A range the server would refuse (to before from, > 92 days) is explained on screen and never sent.
    enabled: !!keys && rangeProblem(range) === null,
    queryFn: () => gatewayReconciliationApi.getReport(range),
    ...GATEWAY_QUERY_OPTIONS,
  });
}
