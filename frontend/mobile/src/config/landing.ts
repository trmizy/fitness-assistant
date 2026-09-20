import type { UserRole } from "../context/AppContext";

/**
 * Where each role belongs when the app has to pick a destination itself — after login, after
 * session restore, or when something lands on "/" with no route of its own.
 *
 * One table, one source of truth: the login screen, the root redirect and the Android back
 * handler must never disagree about where a role's home screen is.
 *
 * Ported from web's config/landing.ts with the SAME paths on purpose. The route folders are real
 * segments (`app/client/…`, not `app/(client)/…`) precisely so these URLs match web's: deep links
 * carry across unchanged, and the zone logic below keeps working as written.
 */
// `as const` matters: expo-router's typed routes (app.json's `experiments.typedRoutes`) check
// navigation targets against a union of the real route files, and a plain `string` does not
// satisfy it. Keeping these as literals means a typo here is a compile error rather than a
// dead-end at runtime — and `satisfies` still enforces that every role has an entry.
export const ROLE_HOME = {
  client: "/client/dashboard",
  pt: "/pt/dashboard",
  gym_owner: "/gym-owner/dashboard",
  admin: "/admin/dashboard",
} as const satisfies Record<UserRole, string>;

/** Resolves a role the same way AppContext does, but from a raw stored/served user object. */
export function roleOf(
  user: { role?: string | null; isPT?: boolean | null } | null | undefined,
): UserRole {
  const raw = String(user?.role ?? "").toUpperCase();
  if (raw === "ADMIN") return "admin";
  if (raw === "GYM_OWNER") return "gym_owner";
  if (user?.isPT || raw === "PT") return "pt";
  return "client";
}

export function landingPathFor(
  user: { role?: string | null; isPT?: boolean | null } | null | undefined,
): RoleHomePath {
  return ROLE_HOME[roleOf(user)];
}

/** The four role home paths, as a literal union expo-router's typed routes accept. */
export type RoleHomePath = (typeof ROLE_HOME)[UserRole];

/**
 * Whether a captured "return to this after login" path is safe to navigate to — a same-app
 * relative path, never an absolute/external one.
 *
 * The `//` check is not redundant: web needed it because `//evil.com` is a protocol-relative URL,
 * and it is kept here because the same string can arrive from a deep link, where handing a
 * router something that parses as an external target is the same class of mistake.
 *
 * Deliberately excludes /login itself — a session-expiry redirect capturing "/login" as the
 * return path would bounce right back to where it started.
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
 * Which workspace zones each role may ENTER — not just which one it calls home.
 *
 * A PT has two: their own professional space AND the ordinary client space, because a trainer is
 * also somebody who trains (see app/client/_layout.tsx, whose guard admits "pt" for exactly this
 * reason, matching web's `allow={["client", "pt"]}`).
 *
 * This list and that guard must agree. Web kept them separate and they disagreed: web's
 * return-path check rejects any path outside the role's OWN zone, so a PT browsing the client
 * workspace, logged out and back in, silently lost their place and landed on the PT dashboard.
 * Deriving both from one table removes the possibility of drift.
 */
const ZONES_ALLOWED: Record<UserRole, UserRole[]> = {
  client: ["client"],
  pt: ["pt", "client"],
  gym_owner: ["gym_owner"],
  admin: ["admin"],
};

/**
 * Whether a "return to this after login" path actually belongs to the role that just logged in.
 *
 * The bug this guards against, carried over from web: a PT logs out while still on /pt/dashboard,
 * the guard redirects to /login carrying `from: "/pt/dashboard"`, and then a DIFFERENT account (a
 * client) logs in on that same screen. `isSafeReturnPath` alone says "/pt/dashboard" is a
 * perfectly good same-app path — which it is, just not for this role — so the client lands there
 * and bounces straight off the role guard.
 *
 * Permissive by construction: only rejects a path starting with a DIFFERENT role's zone. A path
 * outside every zone is left alone rather than guessed at.
 */
export function isReturnPathForRole(path: string, role: UserRole): boolean {
  const allowed = ZONES_ALLOWED[role];
  return (Object.keys(ROLE_HOME) as UserRole[])
    .filter((candidate) => !allowed.includes(candidate))
    .every((forbiddenRole) => {
      const zone = zoneOf(forbiddenRole);
      // The trailing "/" matters: "/ptx" must not read as being inside "/pt".
      return path !== zone && !path.startsWith(zone + "/");
    });
}

/** The workspaces this role may enter. Each workspace's `_layout.tsx` guard mirrors this. */
export function zonesAllowedFor(role: UserRole): UserRole[] {
  return ZONES_ALLOWED[role];
}

/** Where a brand-new client goes after verifying their email — the one real onboarding wizard. */
export const ONBOARDING_PATH = "/client/onboarding" as const;

/**
 * A runtime-supplied path (a `from` param, a deep link) narrowed for expo-router.
 *
 * Typed routes cannot check a value that only exists at runtime, so this is the one place a cast
 * is legitimate — and it is deliberately only reachable AFTER `isSafeReturnPath` and
 * `isReturnPathForRole` have both approved the value. Never call it on a raw parameter.
 */
export function asValidatedRoute(path: string) {
  return path as RoleHomePath;
}
