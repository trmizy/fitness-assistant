import { useCallback, useEffect } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";

/**
 * Re-read an active query whenever the screen comes back into view or the app returns to the foreground.
 *
 * A tab screen stays mounted for the life of the process and the shared QueryClient has
 * `refetchOnWindowFocus: false` (see lib/queryClient.ts), so data that the SERVER can change on its own
 * (e.g. the PT terms version) otherwise stays frozen until a refused action or a re-login.
 *
 * `cancelRefetch: false` keeps it cheap: a request already in flight is reused, so the first focus after
 * mount does not double the initial fetch. Pass an identity-scoped key (it should include the user id).
 */
export function useRefetchOnReturn(queryKey: QueryKey, enabled = true) {
  const queryClient = useQueryClient();
  const keyHash = JSON.stringify(queryKey);

  const refresh = useCallback(() => {
    if (!enabled) return;
    void queryClient.refetchQueries({ queryKey: JSON.parse(keyHash) as QueryKey, type: "active" }, { cancelRefetch: false });
  }, [queryClient, keyHash, enabled]);

  useFocusEffect(refresh);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => sub.remove();
  }, [refresh]);
}
