import crypto from 'crypto';

/**
 * Constant-time comparison of two hex digests (case-insensitive). Different lengths are simply unequal.
 * Used for every gateway signature so a mismatch does not leak how many leading characters were right.
 */
export function safeEqualHex(expected: string, received: unknown): boolean {
  if (typeof received !== 'string' || received.length === 0) return false;
  const a = Buffer.from(expected.toLowerCase(), 'utf-8');
  const b = Buffer.from(received.toLowerCase(), 'utf-8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
