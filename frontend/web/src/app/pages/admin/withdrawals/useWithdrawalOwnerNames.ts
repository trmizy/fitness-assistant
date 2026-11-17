import { useQuery } from "@tanstack/react-query";
import { api } from "../../../services/api";
import { OWNER_LOOKUP_LIMIT, ownerIdsToLookUp, parseOwnerNames, type OwnerName } from "./withdrawalOwnerNames";
import type { WithdrawalRequest } from "./withdrawalQueue";

/**
 * Names of the people on the withdrawal queue, one `GET /admin/users?ids=…` for just those owners. It never blocks the queue:
 * while it loads, or if it fails, the rows keep showing the user code (no retry, no error banner).
 */
export function useWithdrawalOwnerNames(rows: ReadonlyArray<Pick<WithdrawalRequest, "ownerType" | "ownerId">>) {
  const ids = ownerIdsToLookUp(rows);
  return useQuery<Map<string, OwnerName>>({
    queryKey: ["admin", "withdrawal-owner-names", ids],
    queryFn: async () => {
      const { data } = await api.get("/admin/users", { params: { ids: ids.join(","), limit: OWNER_LOOKUP_LIMIT } });
      return parseOwnerNames(data);
    },
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
  });
}
