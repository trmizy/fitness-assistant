import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Pull-to-refresh for a screen backed by react-query.
 *
 * `refetchQueries` rather than `invalidateQueries` on purpose: invalidation marks the data stale
 * and returns immediately, so the spinner would snap away before anything arrived — the gesture
 * would look like it did nothing on a slow connection. Refetching resolves when the network work
 * actually finishes, which is what the user is waiting on.
 *
 * Errors are swallowed here by design: each query already renders its own error state, and a
 * rejected refetch must still end the spinner or the screen looks stuck.
 */
export function usePullToRefresh(queryKeys: readonly unknown[][]) {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all(
        queryKeys.map((queryKey) => queryClient.refetchQueries({ queryKey })),
      );
    } catch {
      // Intentionally ignored — see doc comment.
    } finally {
      setRefreshing(false);
    }
    // The key arrays are written inline at call sites, so a reference check would re-create this
    // callback every render. Serializing is cheap here (a handful of short keys) and stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, JSON.stringify(queryKeys)]);

  return { refreshing, onRefresh };
}
