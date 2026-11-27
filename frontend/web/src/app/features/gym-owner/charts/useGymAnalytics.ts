/**
 * One /analytics request per branch for one range (the three phase-2 panels share it: same key = one request, even when two panels
 * ask). Keys are identity-scoped and start with the gym-stats key, so the Hôm nay "Tải lại" button (invalidateGymStats) refreshes them
 * and an account switch never shows the previous user's numbers. Reads do not retry: a failure is shown with "Thử lại".
 */
import { useQueries } from "@tanstack/react-query";
import { gymService } from "../../../services/api";
import { useGymOwnerScope } from "../scope/GymOwnerScopeProvider";
import { GYM_STATS_KEY } from "../stats/gymStats";
import { analyticsStateOf, type AnalyticsState } from "./analyticsModel";
import type { DateRange } from "./chartsModel";

export const gymAnalyticsKey = (userId: string, gymId: string, from: string, to: string) => [GYM_STATS_KEY, userId, gymId, "analytics", from, to] as const;

export interface GymAnalyticsBranches {
  states: { gymId: string; s: AnalyticsState }[];
  retry: () => void;
}

/** `enabled` = the role may read at least one section this panel shows (fail-closed): no request otherwise. */
export function useGymAnalytics(gymIds: readonly string[], range: DateRange, enabled: boolean): GymAnalyticsBranches {
  const scope = useGymOwnerScope();
  const ids = enabled ? gymIds : [];
  const qs = useQueries({
    queries: ids.map((id) => ({
      queryKey: gymAnalyticsKey(scope.userId, id, range.from, range.to),
      queryFn: () => gymService.getGymAnalytics(id, range),
      retry: false,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    })),
  });
  return {
    states: ids.map((id, i) => ({ gymId: id, s: analyticsStateOf(qs[i] ?? { isError: false }, id, range) })),
    // Refetches what failed, and what the server answered but could not produce (payment-service down: `unavailable`).
    retry: () => qs.forEach((q, i) => {
      const s = analyticsStateOf(q, ids[i], range);
      if (s.state === "error" || (s.state === "ok" && s.data.netIncomeUnavailable)) void q.refetch();
    }),
  };
}
