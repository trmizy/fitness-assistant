import { Preferences } from "../../services/storage";

/**
 * Phase 14.1 — survives the app being killed while the gateway tab is open.
 *
 * Seen for real on the 4 GB emulator: opening VNPay in a Custom Tab made Android's low-memory
 * killer reclaim the (dev-mode, ~960 MB) app; when the gateway redirected back the app cold-started
 * and the dev client dropped the deep link on the way, so the payer landed on the dashboard with a
 * PAID transaction and no word about it. A release build keeps the link, but a link is still not
 * something to depend on — the payer may also just close the tab and open the app from the launcher.
 *
 * So the transaction id is written down before the tab opens and read back once on the next start:
 * the result screen then asks the server, exactly as if the link had arrived. It is scoped to the
 * user who started it (another account signing in on this phone never sees it) and expires with
 * the gateway's own checkout window.
 */
const KEY = "payments.pendingCheckout";
/** VNPay's hosted page itself expires after 15 minutes; a little slack for the round trip. */
export const PENDING_CHECKOUT_TTL_MS = 30 * 60 * 1000;

export interface PendingCheckout {
  transactionId: string;
  userId: string;
  startedAt: number;
}

/** Whether a stored record should still bring this user back to the result screen. */
export function resumableTransaction(
  raw: string | null,
  userId: string | null | undefined,
  now: number,
): string | null {
  if (!raw || !userId) return null;
  try {
    const record = JSON.parse(raw) as Partial<PendingCheckout>;
    if (typeof record.transactionId !== "string" || !record.transactionId) return null;
    if (record.userId !== userId) return null;
    if (typeof record.startedAt !== "number" || now - record.startedAt > PENDING_CHECKOUT_TTL_MS) return null;
    if (record.startedAt > now + 60_000) return null; // a clock that jumped back — don't trust it
    return record.transactionId;
  } catch {
    return null;
  }
}

export async function rememberPendingCheckout(transactionId: string, userId: string): Promise<void> {
  const record: PendingCheckout = { transactionId, userId, startedAt: Date.now() };
  await Preferences.set({ key: KEY, value: JSON.stringify(record) });
}

export async function clearPendingCheckout(): Promise<void> {
  await Preferences.remove({ key: KEY });
}

/** Reads and clears in one go — a resumed checkout is shown once, never on every start. */
export async function takePendingCheckout(userId: string | null | undefined): Promise<string | null> {
  const { value } = await Preferences.get({ key: KEY });
  if (!value) return null;
  await clearPendingCheckout();
  return resumableTransaction(value, userId, Date.now());
}
