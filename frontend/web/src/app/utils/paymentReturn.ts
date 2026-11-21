/**
 * "Come back to where I was" after a gateway checkout (e.g. a client buys a gym membership from inside the
 * PT contract request, pays at VNPay, and must land back on that PT's request step - not on the memberships list).
 *
 * The target is remembered in sessionStorage keyed by the transaction id (it survives the full-page trip to the
 * gateway and back in the same tab), and only an in-app relative path is ever accepted - on the way in AND on the
 * way out - so a crafted value can never become an open redirect. It is navigation only: whether the payment
 * succeeded is still decided by the server's sync answer on the result page.
 */

const KEY_PREFIX = "gymini.paymentReturn.";
const MAX_AGE_MS = 2 * 60 * 60 * 1000;
const MAX_PATH_LENGTH = 500;

export interface PaymentReturnTarget {
  path: string;
  label: string;
}

/** A same-app client path ("/client/..."), or null. Rejects absolute URLs, "//host", "/\host", control chars. */
export function sanitizeReturnTo(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const path = raw.trim();
  if (path.length === 0 || path.length > MAX_PATH_LENGTH) return null;
  if (!path.startsWith("/client/")) return null;
  for (let i = 0; i < path.length; i++) {
    const code = path.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f || code === 0x5c) return null; // control chars and backslash
  }
  if (path.startsWith("//")) return null;
  // No scheme smuggled in before the query ("/client/x:..." is fine, "/client/..//evil" is still same-origin path).
  try {
    const url = new URL(path, "https://app.invalid");
    if (url.origin !== "https://app.invalid") return null;
  } catch {
    return null;
  }
  return path;
}

const keyOf = (txnId: string) => `${KEY_PREFIX}${txnId}`;

export function rememberPaymentReturn(txnId: string | null | undefined, path: unknown, label = "Quay lại đặt gói PT"): void {
  const safe = sanitizeReturnTo(path);
  if (!txnId || !safe) return;
  try {
    sessionStorage.setItem(keyOf(txnId), JSON.stringify({ path: safe, label, at: Date.now() }));
  } catch {
    /* storage blocked: the normal result buttons still work */
  }
}

/** The remembered target for this transaction (re-validated), without removing it. */
export function peekPaymentReturn(txnId: string | null | undefined): PaymentReturnTarget | null {
  if (!txnId) return null;
  try {
    const raw = sessionStorage.getItem(keyOf(txnId));
    if (!raw) return null;
    const rec = JSON.parse(raw) as { path?: unknown; label?: unknown; at?: unknown };
    const path = sanitizeReturnTo(rec.path);
    if (!path || typeof rec.at !== "number" || Date.now() - rec.at > MAX_AGE_MS) return null;
    const label = typeof rec.label === "string" && rec.label.trim() ? rec.label.trim().slice(0, 60) : "Quay lại đặt gói PT";
    return { path, label };
  } catch {
    return null;
  }
}

export function clearPaymentReturn(txnId: string | null | undefined): void {
  if (!txnId) return;
  try {
    sessionStorage.removeItem(keyOf(txnId));
  } catch {
    /* ignore */
  }
}

/** The PT page's request step, reopened with the same trainer / package / branch. */
export function buildPtRequestResumePath(args: { ptId: string; packageId: string; gymId?: string | null }): string {
  const q = new URLSearchParams({ ptId: args.ptId, packageId: args.packageId, resume: "request" });
  if (args.gymId) q.set("gymId", args.gymId);
  return `/client/services?${q.toString()}`;
}

export interface PtRequestResume {
  ptId: string;
  packageId: string;
  gymId: string | null;
}

/** Reads the params written by {@link buildPtRequestResumePath}; null unless it is a complete resume link. */
export function parsePtRequestResume(params: URLSearchParams): PtRequestResume | null {
  if (params.get("resume") !== "request") return null;
  const ptId = params.get("ptId");
  const packageId = params.get("packageId");
  if (!ptId || !packageId) return null;
  return { ptId, packageId, gymId: params.get("gymId") || null };
}
