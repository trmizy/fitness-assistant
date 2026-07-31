import { createHmac, timingSafeEqual } from 'crypto';

// Signs short-lived check-in tokens the member's app shows as a QR; the gym scans it to record
// entry. Mirrors user-service's session join-token (booking.service.joinSession): base64url(payload)
// + HMAC-SHA256 + exp. Rotating + signed so a screenshot can't be reused after it expires.
const SECRET =
  process.env.CHECKIN_TOKEN_SECRET ||
  process.env.INTERNAL_SERVICE_SECRET ||
  'dev_checkin_secret_change_in_production';

const TTL_MS = 2 * 60 * 1000; // 2 minutes

export interface CheckinPayload {
  membershipId: string;
  clientId: string;
  purpose: 'GYM_CHECKIN';
  exp: number;
}

function tokenError(code: string): Error {
  return Object.assign(new Error(code), { status: 400 });
}

export function signCheckinToken(membershipId: string, clientId: string): { token: string; expiresAt: number } {
  const payload: CheckinPayload = { membershipId, clientId, purpose: 'GYM_CHECKIN', exp: Date.now() + TTL_MS };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(encoded).digest('base64url');
  return { token: `${encoded}.${sig}`, expiresAt: payload.exp };
}

export function verifyCheckinToken(token: string): CheckinPayload {
  const [encoded, sig] = String(token || '').split('.');
  if (!encoded || !sig) throw tokenError('INVALID_TOKEN');

  const expected = createHmac('sha256', SECRET).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) throw tokenError('INVALID_TOKEN');

  let payload: CheckinPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw tokenError('INVALID_TOKEN');
  }
  if (payload.purpose !== 'GYM_CHECKIN') throw tokenError('INVALID_TOKEN');
  if (!payload.exp || Date.now() > payload.exp) throw tokenError('TOKEN_EXPIRED');
  return payload;
}
