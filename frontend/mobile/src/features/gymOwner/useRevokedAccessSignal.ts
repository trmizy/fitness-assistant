import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { partnerAccessError, type PartnerAccessError } from "./gymOwner";

/**
 * N15M-06 — a staff member whose access is revoked WHILE the app is open.
 *
 * `RequirePartnerAccess` only asks `/owner/application/status` on mount, so a revoke that lands
 * mid-session used to surface as whatever each screen's own read did with the 403 (a red
 * "Không tải được danh sách chi nhánh"). gym-service answers EVERY `/owner/*` call of a revoked account with
 * 403 `{ success: false, error: { code: "PARTNER_ACCESS_REVOKED" } }` (resolvePartnerContext), so the first
 * query or mutation that fails that way is the signal: the guard then shows the same "Quyền truy cập đã bị
 * thu hồi" screen a restart shows.
 *
 * Only the REVOKED code counts. Other 403s of the owner area (OWNER_ROLE_REQUIRED, STAFF_*…) are an
 * endpoint refusing one role, not the end of the account's access.
 */
export function revokedErrorOf(error: unknown): PartnerAccessError | null {
  const denied = partnerAccessError(error);
  return denied?.kind === "revoked" ? denied : null;
}

/** The revoked answer seen on any query/mutation of the shared client for `userId`, else null. */
export function useRevokedAccessSignal(userId: string | null | undefined, enabled: boolean): PartnerAccessError | null {
  const queryClient = useQueryClient();
  const [seen, setSeen] = useState<{ userId: string; denied: PartnerAccessError } | null>(null);

  useEffect(() => {
    if (!enabled || !userId) return;
    const note = (error: unknown) => {
      const denied = revokedErrorOf(error);
      if (denied) setSeen({ userId, denied });
    };
    const offQueries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error") note(event.action.error);
    });
    const offMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error") note(event.action.error);
    });
    return () => {
      offQueries();
      offMutations();
    };
  }, [queryClient, userId, enabled]);

  // A signal remembered for another account (switch on the same device) must never apply to this one.
  return seen && seen.userId === userId ? seen.denied : null;
}
