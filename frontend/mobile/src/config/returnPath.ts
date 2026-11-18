import { ROLE_HOME, isSafeReturnPath } from "./landing";

/**
 * "Return here after login" for a link that arrives while signed out and the app is COLD.
 *
 * Why this exists (N17M-08). The role guard sends a signed-out visitor to /login carrying the route
 * they were headed to as `from`, read from `usePathname()`. On a warm app that is right. On a cold
 * start expo-router has not published any route info yet when the guard first renders (on Android
 * the initial URL is a Promise, so the store still holds its default `pathname: "/"`), so the guard
 * captured `from: "/"` — a valid same-app path that resolves to the role home, which is exactly
 * where the user landed after logging in, the gym link lost.
 *
 * The link itself is known earlier and exactly: `redirectSystemPath` (app/+native-intent.tsx) sees
 * it before any screen renders. It leaves it here, and the guard/login read it back when `from` is
 * missing or meaningless.
 *
 * Lifetime is deliberately short so it cannot leak to another account:
 *  - only the cold-start (initial) link is remembered, never warm ones, which carry a reliable `from`;
 *  - it is cleared as soon as ANY signed-in guard renders (the link was served, or was not for this
 *    account) and on logout;
 *  - it expires after {@link PENDING_RETURN_TTL_MS}, so an abandoned link cannot redirect a later login;
 *  - it lives in module memory only: a killed app forgets it.
 * Every candidate still passes `isSafeReturnPath` (internal paths only — no open redirect).
 */
export const PENDING_RETURN_TTL_MS = 30 * 60 * 1000;

let pending: { path: string; at: number } | null = null;

/** A path worth returning to: internal and not the bare root, which only means "pick my home". */
export function isMeaningfulReturnPath(path: string | null | undefined): path is string {
  return isSafeReturnPath(path) && path !== "/";
}

/** Role workspace roots ("/client", "/pt", ...) derived from ROLE_HOME, plus the home screens themselves. */
const BARE_ROOTS: ReadonlySet<string> = new Set([
  "/",
  ...Object.values(ROLE_HOME),
  ...Object.values(ROLE_HOME).map((home) => home.slice(0, home.indexOf("/", 1))),
]);

/**
 * A path that only means "somewhere in my workspace" ("/", "/client", "/client/dashboard", ...).
 * On a cold start the router first mounts "/" and redirects to the workspace root, so the guard sees
 * "/client" — a real-looking path that is NOT where the link was headed (device log, N17M-08). Such a
 * path must never override a remembered link. Query/hash are ignored.
 */
export function isBareWorkspaceRoot(path: string | null | undefined): boolean {
  if (typeof path !== "string") return false;
  const bare = path.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  return BARE_ROOTS.has(bare);
}

/**
 * The better of what the guard saw (`candidate`) and the remembered cold-start link: a specific
 * candidate wins; a bare root/missing one yields to the remembered link; with no link, the candidate
 * is used as-is (a plain cold start still ends at the role home).
 */
export function pickReturnPath(
  candidate: string | null | undefined,
  remembered: string | null | undefined,
): string | null {
  const specific = isMeaningfulReturnPath(candidate) && !isBareWorkspaceRoot(candidate);
  if (specific) return candidate;
  if (isMeaningfulReturnPath(remembered)) return remembered;
  return isMeaningfulReturnPath(candidate) ? candidate : null;
}

export function rememberReturnPath(path: string | null | undefined, now: number = Date.now()): void {
  if (isMeaningfulReturnPath(path)) pending = { path, at: now };
}

/** The remembered path if it is still fresh; does NOT consume it (login reads it from two places). */
export function peekReturnPath(now: number = Date.now()): string | null {
  if (!pending) return null;
  if (now - pending.at > PENDING_RETURN_TTL_MS || now < pending.at) {
    pending = null;
    return null;
  }
  return pending.path;
}

export function clearReturnPath(): void {
  pending = null;
}

/**
 * AWS-MOB-ISO-01 — a deliberate "Đăng xuất" is not a session that dropped mid-flow. The guard used to
 * carry the screen being left (a payment result, say) as `from`, so the NEXT account signing in was
 * sent back onto the previous user's screen and re-queried it under the new identity. While this is
 * set, {@link resolveReturnPath} offers nothing and the new login lands on its own role home.
 * It is cleared by the next sign-in.
 */
let signedOutOnPurpose = false;

export function markSignedOutOnPurpose(): void {
  signedOutOnPurpose = true;
  pending = null;
}

export function clearSignedOutOnPurpose(): void {
  signedOutOnPurpose = false;
}

/**
 * The `from` to put on the /login redirect: the path the guard saw when it is meaningful, else the
 * remembered cold-start link, else nothing.
 */
export function resolveReturnPath(
  candidate: string | null | undefined,
  now: number = Date.now(),
): string | null {
  if (signedOutOnPurpose) return null;
  return pickReturnPath(candidate, peekReturnPath(now));
}

/**
 * N17M-01 / FIX8-5 — how to navigate to a route that lives INSIDE a workspace tab's own stack
 * (`/client/services/gyms/<id>`, `/client/profile/wallet`, `/pt/service-orders/<id>` ...) from outside that stack.
 *
 * The tab's stack is not mounted yet, so expo-router starts it with ONLY the target screen: the layout's
 * `unstable_settings.initialRouteName` applies to cold-start links only. The hub (`index`) is then missing
 * underneath, and Android SYSTEM back exits the app instead of going to the hub (the in-app arrow worked
 * because it routes explicitly). `withAnchor: true` makes expo-router (getNavigationAction.js: `initial = false`
 * at every level) load the initial route under the target. It works for push and replace alike.
 * Plain tab roots (`/client/services?tab=contracts`, `/client/dashboard`, `/pt/schedule`) have nothing to anchor, so
 * they get no options (the flag would only add a stray `initial` param to their search params).
 */
const NESTED_ROUTE = /^\/(?:client|pt|admin|gym-owner)\/[^/?#]+\/[^/?#]+/;
export function anchorOptionsFor(route: string): { withAnchor: true } | undefined {
  return NESTED_ROUTE.test(route) ? { withAnchor: true } : undefined;
}
