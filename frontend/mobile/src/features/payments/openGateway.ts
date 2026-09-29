import * as WebBrowser from "expo-web-browser";
import { router } from "expo-router";

import { PAYMENT_RETURN_PREFIX, resultHref, txnIdFromReturnUrl } from "./payments";
import { clearPendingCheckout, rememberPendingCheckout } from "./pendingCheckout";

/**
 * Phase 14.1 — opens a gateway's checkout page (web: services/paymentGateway.ts).
 *
 * The page goes into a system browser tab (Custom Tab on Android) with the app alive underneath,
 * never into the app itself. The tab ends one of two ways, and both land on the same screen:
 *   - the gateway redirects to `fitnessassistant://client/payments/result?txnId=…` (payment-service
 *     picks that for a checkout started with MOBILE_CHECKOUT), which closes the tab; or
 *   - the payer closes the tab themselves — paid, cancelled or just backed out, we don't guess.
 * The result screen then asks `POST /me/payments/:id/sync`; nothing the tab or the link says is
 * treated as proof of payment.
 *
 * If the app is killed while the tab is open, this promise is gone with it. The transaction id is
 * therefore written down first (pendingCheckout.ts) and the next start resumes onto the result
 * screen — whether or not the gateway's deep link survived the cold start.
 */
let open = false;

export async function openPaymentGateway({
  url,
  transactionId,
  userId,
}: {
  url: string;
  transactionId: string | null;
  /** Who started the checkout — the resume record is only ever shown back to them. */
  userId: string | null | undefined;
}): Promise<void> {
  // One tab at a time: a second tap while the first is still opening would start a second
  // checkout page for the same transaction.
  if (open) return;
  open = true;
  try {
    if (transactionId && userId) await rememberPendingCheckout(transactionId, userId);
    const result = await WebBrowser.openAuthSessionAsync(url, PAYMENT_RETURN_PREFIX);
    // Back in the same app process: the tab's own outcome is enough to land on the result screen.
    await clearPendingCheckout();
    const fromLink = result.type === "success" ? txnIdFromReturnUrl(result.url) : null;
    router.navigate(resultHref(fromLink ?? transactionId) as never);
  } finally {
    open = false;
  }
}
