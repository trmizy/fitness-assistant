import { resultHref, txnIdFromReturnUrl } from "../src/features/payments/payments";

/**
 * Rewrites incoming deep links before Expo Router routes them.
 *
 * Only one link is touched: the gateway's return trip `fitnessassistant://client/payments/result?
 * txnId=…&status=…` (Phase 14.1). Its `status` is dropped on purpose — the result screen must ask
 * the server, and a route that carried `status=success` would invite reading it. What is left is
 * exactly the href openPaymentGateway navigates to itself, so the two arrivals (link + the tab's
 * promise resolving) point at the same route instead of stacking two result screens.
 *
 * Everything else passes through unchanged.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (/(^|\/\/|\/)client\/payments\/result(\?|$)/.test(path)) {
      return resultHref(txnIdFromReturnUrl(path));
    }
  } catch {
    // Never let a malformed link crash the app on launch — route it as it came.
  }
  return path;
}
