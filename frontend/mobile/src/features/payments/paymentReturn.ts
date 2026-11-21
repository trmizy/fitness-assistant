/**
 * "Come back to where I was" after a gateway checkout - e.g. a client buys a gym membership from inside a PT's contract
 * request, pays, and must land back on that trainer's request step (same package, same branch), not on the memberships list.
 * Pure helpers (the storage half is paymentReturnStore.ts). Web twin: web/src/app/utils/paymentReturn.ts.
 *
 * Only an in-app client path is ever accepted - when it is written down AND when it is read back - so a crafted value can
 * never turn into an open redirect. It is navigation only: whether the payment succeeded is still the server's sync answer.
 */

export const PAYMENT_RETURN_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_PATH_LENGTH = 500;

export interface PaymentReturnRecord {
  transactionId: string;
  userId: string;
  path: string;
  at: number;
}

/** A same-app client path ("/client/..."), or null. Rejects absolute URLs, "//host", backslashes and control characters. */
export function sanitizeReturnTo(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const path = raw.trim();
  if (path.length === 0 || path.length > MAX_PATH_LENGTH) return null;
  if (!path.startsWith("/client/") || path.startsWith("//")) return null;
  for (let i = 0; i < path.length; i++) {
    const code = path.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f || code === 0x5c) return null;
  }
  return path;
}

/** The trainer screen reopened with the package (and branch) the client was requesting. */
export function buildPtRequestReturnPath(args: { ptUserId: string; packageId: string; gymId?: string | null }): string {
  const q = [`packageId=${encodeURIComponent(args.packageId)}`];
  if (args.gymId) q.push(`gymId=${encodeURIComponent(args.gymId)}`);
  return `/client/services/pt/${encodeURIComponent(args.ptUserId)}?${q.join("&")}`;
}

/** The stored record's path, if it belongs to this user and transaction, is fresh, and is still a safe path. */
export function resumablePaymentReturn(
  raw: string | null,
  transactionId: string | null | undefined,
  userId: string | null | undefined,
  now: number,
): string | null {
  if (!raw || !transactionId || !userId) return null;
  try {
    const rec = JSON.parse(raw) as Partial<PaymentReturnRecord>;
    if (rec.transactionId !== transactionId || rec.userId !== userId) return null;
    if (typeof rec.at !== "number" || now - rec.at > PAYMENT_RETURN_TTL_MS || rec.at > now + 60_000) return null;
    return sanitizeReturnTo(rec.path);
  } catch {
    return null;
  }
}
