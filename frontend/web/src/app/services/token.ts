/**
 * JWT inspection helpers — read-only, and deliberately dependency-free so they
 * stay unit-testable in plain Node (no browser, no Capacitor, no axios).
 *
 * These NEVER verify a signature. The server is the only thing that can do
 * that. All we need on the client is "is it worth sending this token, or
 * should we refresh first?", which is a scheduling question, not a security
 * one — a forged token still gets rejected by the backend.
 */

/** Treat a token as expired this many seconds BEFORE its real `exp`, so a
 *  request never leaves with a token that dies mid-flight. */
export const EXPIRY_SKEW_SECONDS = 60;

export function hasUsableToken(token: string | null | undefined): token is string {
  return !!token && token !== "null" && token !== "undefined";
}

/** Decodes a JWT's payload. Returns null for anything malformed — callers must
 *  treat null as "assume expired" and take the refresh path. */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    // base64url → base64, then pad to a multiple of 4.
    let base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    base64 += "=".repeat((4 - (base64.length % 4)) % 4);

    const json = atob(base64);
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * True when the token is missing, unreadable, has no `exp`, or expires within
 * EXPIRY_SKEW_SECONDS. Every one of those cases should send the caller down
 * the refresh path — an unreadable token is not a token we can rely on.
 */
export function isAccessTokenExpiringSoon(
  token: string | null | undefined,
  skewSeconds: number = EXPIRY_SKEW_SECONDS,
): boolean {
  if (!hasUsableToken(token)) return true;

  const payload = decodeJwtPayload(token);
  if (!payload) return true;

  const exp = payload.exp;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return true;

  const nowSeconds = Date.now() / 1000;
  return exp - nowSeconds <= skewSeconds;
}
