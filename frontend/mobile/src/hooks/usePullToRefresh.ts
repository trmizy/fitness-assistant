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

  // The key arrays are written inline at call sites, so their identity changes every render.
  // Serializing gives a stable dependency (a handful of short keys), and the callback reads the keys
  // back from that same string, so it can never refetch a stale set. react-query hashes keys with
  // JSON too, so an `undefined` that serializes to `null` still matches the same query.
  const keysSignature = JSON.stringify(queryKeys);

  const onRefresh = useCallback(async () => {
    const keys = JSON.parse(keysSignature) as unknown[][];
    setRefreshing(true);
    try {
      await Promise.all(keys.map((queryKey) => queryClient.refetchQueries({ queryKey })));
    } catch {
      // Intentionally ignored — see doc comment.
    } finally {
      setRefreshing(false);
    }
  }, [queryClient, keysSignature]);

  return { refreshing, onRefresh };
}
