import { authServiceClient } from "../../clients/auth-service.client";
import { caseError } from "./errors";

/**
 * The person a case is assigned to must be a REAL, active ADMIN account (auth-service says so; an outage fails closed). The same check, with the same
 * codes, as the late-open hand-over (late-open-reconciliation.service.ts assertRealAdmin). Role-based only: the system has no finer admin permissions.
 *
 * The lookup is a replaceable seam so a suite that has no auth-service can answer it; the default is the real internal auth-service call.
 */
export type AdminAccountLookup = (userId: string) => Promise<{ role?: string; isActive?: boolean } | null>;

const httpLookup: AdminAccountLookup = async (userId) => {
  try {
    const { data } = await authServiceClient.internalGet(`/auth/internal/users/${encodeURIComponent(userId)}`, { timeoutMs: 3000 });
    return data?.user ?? null;
  } catch (e: any) {
    if (e?.response?.status === 404) return null;
    throw caseError(503, "ACCOUNT_LOOKUP_UNAVAILABLE", "Không kiểm tra được tài khoản người nhận lúc này, hãy thử lại");
  }
};

let lookup: AdminAccountLookup = httpLookup;

/** TEST SEAM: replace the lookup (pass nothing to restore the real one). */
export function setAdminAccountLookupForTests(fn?: AdminAccountLookup): void {
  lookup = fn ?? httpLookup;
}

export async function assertRealAdmin(userId: string): Promise<void> {
  const user = await lookup(userId);
  if (!user) throw caseError(422, "ASSIGNEE_NOT_FOUND", "Không tìm thấy tài khoản của người được giao");
  if (user.role !== "ADMIN" || user.isActive === false) throw caseError(422, "ASSIGNEE_NOT_ADMIN", "Người được giao phải là quản trị viên đang hoạt động");
}
