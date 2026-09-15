/**
 * JWT inspection helpers — read-only, and deliberately dependency-free so they
 * stay unit-testable in plain Node (no browser, no React Native, no axios).
 *
 * These NEVER verify a signature. The server is the only thing that can do
 * that. All we need on the client is "is it worth sending this token, or
 * should we refresh first?", which is a scheduling question, not a security
 * one — a forged token still gets rejected by the backend.
 *
 * Ported from web's services/token.ts. The one real difference: web decoded the payload with
 * `atob`, which is a browser global that Hermes does not provide. Rather than reach for a
 * polyfill (an extra dependency on the startup hot path, and a second code path that unit tests
 * in Node would not exercise), the base64url + UTF-8 decoding is done in plain JS below — which
 * also keeps this file honest about being importable anywhere.
 */

/** Treat a token as expired this many seconds BEFORE its real `exp`, so a
 *  request never leaves with a token that dies mid-flight. */
export const EXPIRY_SKEW_SECONDS = 60;

export function hasUsableToken(token: string | null | undefined): token is string {
  return !!token && token !== "null" && token !== "undefined";
}

const B64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** base64 (already un-url-ified and padded) -> raw bytes. Null for anything malformed. */
function base64ToBytes(base64: string): number[] | null {
  const bytes: number[] = [];
  let buffer = 0;
  let bitsCollected = 0;

  for (const char of base64) {
    if (char === "=") break;
    const value = B64_ALPHABET.indexOf(char);
    if (value === -1) return null;

    buffer = (buffer << 6) | value;
    bitsCollected += 6;
    if (bitsCollected >= 8) {
      bitsCollected -= 8;
      bytes.push((buffer >> bitsCollected) & 0xff);
    }
  }

  return bytes;
}

/** UTF-8 bytes -> string. Multi-byte sequences matter: a JWT can carry a non-ASCII name. */
function bytesToUtf8(bytes: number[]): string {
  let out = "";

  for (let i = 0; i < bytes.length; ) {
    const byte = bytes[i];
    let codePoint: number;
    let extraBytes: number;

    if (byte < 0x80) {
      codePoint = byte;
      extraBytes = 0;
    } else if ((byte & 0xe0) === 0xc0) {
      codePoint = byte & 0x1f;
      extraBytes = 1;
    } else if ((byte & 0xf0) === 0xe0) {
      codePoint = byte & 0x0f;
      extraBytes = 2;
    } else if ((byte & 0xf8) === 0xf0) {
      codePoint = byte & 0x07;
      extraBytes = 3;
    } else {
      return ""; // invalid leading byte — caller treats "" as unparseable
    }

    if (i + extraBytes >= bytes.length) return ""; // truncated multi-byte sequence
    for (let n = 1; n <= extraBytes; n++) {
      const continuation = bytes[i + n];
      if ((continuation & 0xc0) !== 0x80) return "";
      codePoint = (codePoint << 6) | (continuation & 0x3f);
    }

    out += String.fromCodePoint(codePoint);
    i += extraBytes + 1;
  }

  return out;
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

    const bytes = base64ToBytes(base64);
    if (!bytes || bytes.length === 0) return null;

    const json = bytesToUtf8(bytes);
    if (!json) return null;

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
