import { Preferences } from "../../services/storage";
import { resumablePaymentReturn, sanitizeReturnTo, type PaymentReturnRecord } from "./paymentReturn";

/** Persistence half of paymentReturn.ts: survives the app being killed while the gateway tab is open (like pendingCheckout.ts). */
const KEY = "payments.returnTo";

export async function rememberPaymentReturn(
  transactionId: string | null | undefined,
  userId: string | null | undefined,
  path: unknown,
): Promise<void> {
  const safe = sanitizeReturnTo(path);
  if (!transactionId || !userId || !safe) return;
  const record: PaymentReturnRecord = { transactionId, userId, path: safe, at: Date.now() };
  await Preferences.set({ key: KEY, value: JSON.stringify(record) });
}

export async function peekPaymentReturn(
  transactionId: string | null | undefined,
  userId: string | null | undefined,
): Promise<string | null> {
  const { value } = await Preferences.get({ key: KEY });
  return resumablePaymentReturn(value, transactionId, userId, Date.now());
}

export async function clearPaymentReturn(): Promise<void> {
  await Preferences.remove({ key: KEY });
}
