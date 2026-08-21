import { createHmac, timingSafeEqual } from 'crypto';

// Signs the check-in QR a gym displays at its front desk. The member scans it with their
// phone; their app then calls the check-in endpoint with this token plus their own bearer
// token, so the gym never has to operate a scanner and the member's identity comes from
// their session rather than from anything encoded in the image.
//
// Construction mirrors user-service's session join-token: base64url(payload) + HMAC-SHA256.
// The signature is what makes the code unforgeable — a stranger cannot mint one for a gym
// they don't own. It stays valid for a long window because the poster on the wall is not
// reprinted daily; entitlement is re-checked on every scan (membership ACTIVE, still in
// date, visits remaining, cooldown), which is what actually protects the gym.
const SECRET =
  process.env.CHECKIN_TOKEN_SECRET ||
  process.env.INTERNAL_SERVICE_SECRET ||
  'dev_checkin_secret_change_in_production';

/** How long a printed gym QR stays usable before the owner should regenerate it. */
const GYM_QR_TTL_MS = Number(process.env.GYM_QR_TTL_DAYS ?? '365') * 24 * 60 * 60 * 1000;

export interface GymCheckinPayload {
  gymId: string;
  purpose: 'GYM_CHECKIN_QR';
  exp: number;
}

function tokenError(code: string): Error {
  return Object.assign(new Error(code), { status: 400 });
}

export function signGymCheckinToken(gymId: string): {
  token: string;
  expiresAt: number;
} {
  const payload: GymCheckinPayload = {
    gymId,
    purpose: 'GYM_CHECKIN_QR',
    exp: Date.now() + GYM_QR_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(encoded).digest('base64url');
  return { token: `${encoded}.${sig}`, expiresAt: payload.exp };
}

export function verifyGymCheckinToken(token: string): GymCheckinPayload {
  const [encoded, sig] = String(token || '').split('.');
  if (!encoded || !sig) throw tokenError('INVALID_TOKEN');

  const expected = createHmac('sha256', SECRET).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw tokenError('INVALID_TOKEN');
  }

  let payload: GymCheckinPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw tokenError('INVALID_TOKEN');
  }
  if (payload.purpose !== 'GYM_CHECKIN_QR') throw tokenError('INVALID_TOKEN');
  if (!payload.exp || Date.now() > payload.exp) throw tokenError('TOKEN_EXPIRED');
  return payload;
}
