import type { UserRole } from "../context/AppContext";

/**
 * Where each role belongs when the app has to pick a destination itself — after login,
 * after session restore, or when something lands on "/" with no route of its own.
 *
 * One table, one source of truth: the login form, the root redirect and the Android
 * back-button handler must never disagree about where a role's home screen is.
 */
export const ROLE_HOME: Record<UserRole, string> = {
  client: "/client/dashboard",
  pt: "/pt/dashboard",
  gym_owner: "/gym-owner/dashboard",
  admin: "/admin/dashboard",
};

/** Resolves a role the same way AppContext does, but from a raw stored/served user object. */
export function roleOf(user: { role?: string | null; isPT?: boolean | null } | null | undefined): UserRole {
  const raw = String(user?.role ?? "").toUpperCase();
  if (raw === "ADMIN") return "admin";
  if (raw === "GYM_OWNER") return "gym_owner";
  if (user?.isPT || raw === "PT") return "pt";
  return "client";
}

export function landingPathFor(user: { role?: string | null; isPT?: boolean | null } | null | undefined): string {
  return ROLE_HOME[roleOf(user)];
}

/**
 * Whether a captured "return to this after login" path is safe to navigate to —
 * a same-app relative path, never an absolute/external URL. `//evil.com` parses
 * as a protocol-relative URL in a real browser (same as `https://evil.com`), so
 * requiring exactly one leading slash (not two) matters, not just "starts with /".
 *
 * Deliberately excludes /login itself — a session-expiry redirect capturing
 * "/login" as the return path would bounce right back to where it started.
 */
export function isSafeReturnPath(path: string | null | undefined): path is string {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    path.startsWith("/") &&
    !path.startsWith("//") &&
    path !== "/login"
  );
}

/** Each role's own top-level workspace segment, e.g. "/pt" for ROLE_HOME.pt's "/pt/dashboard". */
function zoneOf(role: UserRole): string {
  const home = ROLE_HOME[role];
  return home.slice(0, home.indexOf("/", 1));
}

/**
 * Whether a "return to this after login" path actually belongs to the role that just logged
 * in — the bug this guards against: PT logs out from /pt/dashboard while still ON that page,
 * RequireRole sees isAuthenticated flip to false and redirects to /login carrying
 * `state.from: "/pt/dashboard"`; a DIFFERENT account (a client) then logs in on that same
 * /login screen, and isSafeReturnPath alone says "/pt/dashboard" is a perfectly safe
 * same-app relative path — which it is, just not for this role — so the client got dropped
 * on /pt/dashboard and bounced off RequireRole's role check into "403 — Không có quyền truy
 * cập". isSafeReturnPath stays a pure open-redirect check (still needed on its own); this is
 * the separate "is it even reachable by this role" check, applied at the same call sites.
 *
 * Permissive by construction: only rejects a path that starts with a DIFFERENT role's own
 * zone — a path outside every zone (there is currently no such route, but nothing here
 * assumes otherwise) is left alone rather than guessed at.
 */
export function isReturnPathForRole(path: string, role: UserRole): boolean {
  return (Object.keys(ROLE_HOME) as UserRole[])
    .filter((r) => r !== role)
    .every((otherRole) => {
      const otherZone = zoneOf(otherRole);
      return path !== otherZone && !path.startsWith(otherZone + "/");
    });
}
