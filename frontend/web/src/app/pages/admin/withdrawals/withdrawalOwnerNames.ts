/**
 * VERIFY5: the requester of a withdrawal is shown by NAME in the admin queue, not by a bare user code.
 *
 * The payment-service queue only knows the owner's id. The names come from the admin user directory
 * (`GET /admin/users?ids=a,b,c&limit=200`, the same lookup the mobile admin uses), asked for ONLY the owners on screen.
 * A GYM wallet's ownerId is a branch id, not a user id, so it is never looked up here; the person who asked (requestedByUserId) is looked up instead, and an older row without one keeps the "Phòng gym" label.
 * Unknown ids stay on the existing "Người dùng <mã>" fallback: a failed lookup never hides or blocks a request.
 */
import type { WithdrawalRequest } from "./withdrawalQueue";

/** The gateway accepts 1..200 ids per call. */
export const OWNER_LOOKUP_LIMIT = 200;

export interface OwnerName {
  name: string;
  email?: string;
}

/**
 * The user whose name is shown as the person behind a request: the owner for PT / CLIENT; for a GYM wallet (ownerId = a BRANCH id) the person who
 * asked (requestedByUserId, 22/11/2026), or "" for an older row that never recorded one.
 */
export function withdrawalRequesterId(r: Pick<WithdrawalRequest, "ownerType" | "ownerId" | "requestedByUserId">): string {
  return r.ownerType === "GYM" ? (r.requestedByUserId ?? "") : r.ownerId;
}

/** Distinct, sorted user ids worth looking up (PT / CLIENT owners, and the requester of a GYM request), capped at the gateway limit. Sorted so the query key is stable. */
export function ownerIdsToLookUp(rows: ReadonlyArray<Pick<WithdrawalRequest, "ownerType" | "ownerId"> & { requestedByUserId?: string | null }>): string[] {
  const ids = new Set<string>();
  for (const r of rows) {
    const id = withdrawalRequesterId({ ownerType: r.ownerType, ownerId: r.ownerId, requestedByUserId: r.requestedByUserId });
    if (id) ids.add(id);
  }
  return [...ids].sort().slice(0, OWNER_LOOKUP_LIMIT);
}

/** `{ data: { users: [...] } }`, `{ users: [...] }` or a bare array → id → name. Rows without a usable name are skipped. */
export function parseOwnerNames(raw: unknown): Map<string, OwnerName> {
  const map = new Map<string, OwnerName>();
  const root = (raw ?? null) as { data?: unknown; users?: unknown } | unknown[] | null;
  const inner = Array.isArray(root) ? root : ((root as { data?: unknown })?.data ?? root);
  const list = Array.isArray(inner) ? inner : (inner as { users?: unknown } | null)?.users;
  if (!Array.isArray(list)) return map;
  for (const u of list as Array<{ id?: unknown; name?: unknown; email?: unknown } | null>) {
    if (!u || typeof u.id !== "string") continue;
    const name = typeof u.name === "string" ? u.name.trim() : "";
    const email = typeof u.email === "string" ? u.email.trim() : "";
    if (!name && !email) continue;
    map.set(u.id, { name: name || email, ...(email ? { email } : {}) });
  }
  return map;
}
