import { resultHref, returnHintFromUrl, txnIdFromReturnUrl } from "../src/features/payments/payments";
import { gymAppLinkRoute } from "../src/features/services/gymAppLink";
import { rememberReturnPath } from "../src/config/returnPath";

/**
 * Rewrites incoming deep links before Expo Router routes them.
 *
 * Only one link is touched: the gateway's return trip `fitnessassistant://client/payments/result?
 * txnId=…&status=…` (Phase 14.1). Its `status` is dropped on purpose — the result screen must ask
 * the server, and a route that carried `status=success` would invite reading it. What is left is
 * exactly the href openPaymentGateway navigates to itself, so the two arrivals (link + the tab's
 * promise resolving) point at the same route instead of stacking two result screens. The one thing
 * kept is a display-only `gw=failed` hint when ZaloPay reports a non-success number (N17M-03).
 *
 * The second is the Android App Link `https://gymini.vn/gyms/<id>` (the gym share link): it opens the
 * client gym detail. Logged out, the client workspace guard sends the user to /login carrying that route
 * as `from`, so after signing in they land on the gym; other roles meet the guard's own screen.
 *
 * Everything else passes through unchanged.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  try {
    const gymRoute = gymAppLinkRoute(path);
    if (gymRoute) return rememberColdStart(gymRoute, initial);
    if (/(^|\/\/|\/)client\/payments\/result(\?|$)/.test(path)) {
      return rememberColdStart(resultHref(txnIdFromReturnUrl(path), returnHintFromUrl(path)), initial);
    }
  } catch {
    // Never let a malformed link crash the app on launch — route it as it came.
  }
  return path;
}

/**
 * N17M-08 — on a COLD start the role guard cannot read the route it is guarding (expo-router has not
 * published it yet), so a signed-out visitor was sent to /login with `from: "/"` and lost the link.
 * The link is known right here, before any screen renders; leave it for the guard and login to use.
 * Warm links are not remembered: the guard reads their route reliably, and remembering them would only
 * lengthen how long a stale link could survive (see config/returnPath for the full lifetime rules).
 */
function rememberColdStart(route: string, initial: boolean): string {
  if (initial) rememberReturnPath(route);
  return route;
}
