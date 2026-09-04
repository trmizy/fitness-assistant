import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";

/**
 * Opens a payment gateway's checkout page.
 *
 * On the web this is what it always was: navigate the tab to the gateway.
 *
 * Inside the Capacitor app it must NOT be. `window.location.href = gatewayUrl` drives the
 * app's own WebView out of the React app entirely — history is destroyed, every bit of
 * in-memory state is lost, and when the gateway redirects back the user is left in a
 * browser that has no idea it used to be an app. The gateway goes in a system browser tab
 * instead, with the React app still alive underneath it.
 *
 * ── How the result comes back ─────────────────────────────────────────────────────────
 * The backend's return URL points at the WEB app (`${FRONTEND_URL}/client/payments/result`),
 * not at a custom scheme, and changing that is backend work that is out of scope here. So
 * the app does not wait for a deep link: it waits for the browser tab to CLOSE
 * (`browserFinished`), then goes to its own result screen, which asks the server what
 * actually happened.
 *
 * ── The security rule that matters ────────────────────────────────────────────────────
 * Nothing the browser (or a deep link, if one is wired up later) says is treated as proof
 * of payment. `?success=true` is just text anyone can produce. The ONLY thing that decides
 * whether a payment happened is the server's own answer — PaymentResultPage always calls
 * `POST /me/payments/:id/sync` and shows success only if the server says PAID. The gateway
 * webhook remains the single source of truth, exactly as the backend already assumes.
 */

export interface OpenGatewayOptions {
  /** The gateway's checkout URL, straight from the purchase/pay response. */
  url: string;
  /** Transaction id from the same response — needed to ask the server what happened. */
  transactionId?: string | null;
  /**
   * Router navigation, injected so this module stays outside the React tree.
   * Called once the user comes back from the browser tab.
   */
  navigate: (path: string) => void;
}

/** Where the app sends the user once the gateway tab closes. */
function resultPath(transactionId?: string | null): string {
  return transactionId
    ? `/client/payments/result?txnId=${encodeURIComponent(transactionId)}`
    : "/client/payments/result";
}

export async function openPaymentGateway({
  url,
  transactionId,
  navigate,
}: OpenGatewayOptions): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    // Web: unchanged behaviour — the gateway's own redirect brings the user back.
    window.location.href = url;
    return;
  }

  // Fires when the user closes the tab — whether they paid, cancelled, or just backed out.
  // We deliberately do NOT guess which: the result screen asks the server.
  const finished = await Browser.addListener("browserFinished", () => {
    void finished.remove();
    navigate(resultPath(transactionId));
  });

  try {
    await Browser.open({ url, presentationStyle: "popover" });
  } catch (err) {
    void finished.remove();
    throw err;
  }
}
