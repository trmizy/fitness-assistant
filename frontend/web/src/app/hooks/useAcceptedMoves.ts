import { useQueries } from "@tanstack/react-query";
import { sessionService } from "../services/api";
import { acceptedMovesOf } from "../utils/reschedule";

/**
 * How many times each CONFIRMED session was already moved (max 2, server-enforced), read up front from its reschedule history -
 * the upcoming-sessions lists only carry the open proposal. Returns undefined for a session whose history has not loaded (yet),
 * so callers never claim the cap before they know. Invalidate ["session-reschedule-history"] after any reschedule action.
 */
export function useAcceptedMoves(sessions: ReadonlyArray<{ id: string; status: string }>): (sessionId: string) => number | undefined {
  const ids = sessions.filter((s) => s.status === "CONFIRMED").map((s) => s.id);
  const queries = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["session-reschedule-history", id],
      queryFn: () => sessionService.getRescheduleHistory(id),
      staleTime: 30_000,
    })),
  });
  const moves = new Map<string, number>();
  ids.forEach((id, i) => {
    if (queries[i]?.isSuccess) moves.set(id, acceptedMovesOf(queries[i].data));
  });
  return (sessionId: string) => moves.get(sessionId);
}
