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

/** INT-01: ACTIVE ADMIN accounts for the assignee / hand-over picker. Names only (no email); auth-service is the only source; an outage is a 503. */
export type AdminDirectoryLookup = () => Promise<Array<{ id: string; firstName?: string | null; lastName?: string | null }>>;

const httpDirectory: AdminDirectoryLookup = async () => {
  try {
    const { data } = await authServiceClient.internalGet("/auth/internal/admins", { timeoutMs: 3000 });
    return Array.isArray(data?.admins) ? data.admins : [];
  } catch {
    throw caseError(503, "ACCOUNT_LOOKUP_UNAVAILABLE", "Không lấy được danh sách quản trị viên lúc này, hãy thử lại");
  }
};
let directory: AdminDirectoryLookup = httpDirectory;

/** TEST SEAM: replace the directory lookup (pass nothing to restore the real one). */
export function setAdminDirectoryLookupForTests(fn?: AdminDirectoryLookup): void {
  directory = fn ?? httpDirectory;
}

export async function listActiveAdmins(): Promise<Array<{ id: string; displayName: string | null }>> {
  const rows = await directory();
  return rows.map((r) => {
    const name = [r.firstName, r.lastName].map((x) => (x ?? "").trim()).filter(Boolean).join(" ");
    return { id: r.id, displayName: name || null };
  });
}
