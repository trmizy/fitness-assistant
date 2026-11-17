/**
 * VERIFY5: the requester of a withdrawal is shown by NAME in the admin queue, not by a bare user code.
 *
 * The payment-service queue only knows the owner's id. The names come from the admin user directory
 * (`GET /admin/users?ids=a,b,c&limit=200`, the same lookup the mobile admin uses), asked for ONLY the owners on screen.
 * A GYM wallet's ownerId is a branch id, not a user id, so it is never looked up here (it keeps the existing "Phòng gym" label).
 * Unknown ids stay on the existing "Người dùng <mã>" fallback: a failed lookup never hides or blocks a request.
 */
import type { WithdrawalRequest } from "./withdrawalQueue";

/** The gateway accepts 1..200 ids per call. */
export const OWNER_LOOKUP_LIMIT = 200;

export interface OwnerName {
  name: string;
  email?: string;
}

/** Distinct, sorted user ids worth looking up (PT / CLIENT owners only), capped at the gateway limit. Sorted so the query key is stable. */
export function ownerIdsToLookUp(rows: ReadonlyArray<Pick<WithdrawalRequest, "ownerType" | "ownerId">>): string[] {
  const ids = new Set<string>();
  for (const r of rows) {
    if ((r.ownerType === "PT" || r.ownerType === "CLIENT") && r.ownerId) ids.add(r.ownerId);
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
