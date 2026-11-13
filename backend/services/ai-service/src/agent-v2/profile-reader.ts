/**
 * Gymini V2 (EXPERIMENTAL, flag AI_AGENT_V2 default OFF) — M7-P0: the real Gate 1 profile reader (4-state contract).
 *
 * Reads the authenticated user's OWN profile (user-service GET /profile/me, authorised by the caller's own Authorization
 * header) and returns exactly one of the supervisor's states (multi-agent-contracts.ts `ProfileReadResult`):
 *   PROFILE_OK            read succeeded and a valid age is on the profile
 *   AGE_UNKNOWN           read succeeded; no valid age (no profile saved yet, age not set / out of range / wrong type)
 *   PROFILE_ACCESS_DENIED HTTP 401 / 403, no credentials, or the returned profile belongs to another user
 *   PROFILE_UNAVAILABLE   timeout, 5xx, any other non-2xx, network failure, malformed response, a thrown transport
 * A failed read is NEVER turned into an empty profile (that is what V1 profileExtractor does with allSettled — kept as is
 * for V1; this reader does not use it).
 *
 * Transport: agent-v2 owns no HTTP client (static isolation rule). The composition root injects the V1 service client
 * (ai-service clients/service-lambda.client.ts — HTTP locally, Lambda Invoke on AWS); `ProfileServiceGet` is its structural
 * shape. Both transports throw on non-2xx with `status` / `response.status` set, which is what `classifyProfileReadError` reads.
 *
 * Identity: only the authenticated context (userId + Authorization header) is used. The path carries no user id (the
 * service resolves the user from the token); a profile whose `userId` differs from the authenticated userId is refused.
 * Privacy: this module never logs. The age leaves it only inside the result handed to Gate 1; traces carry the STATUS only.
 */
import type { ProfileReadResult, SupervisorProfileReader } from "./multi-agent-contracts";
import type { AuthenticatedToolContext } from "./tool-contract";

export interface ProfileServiceRequest {
  service: "user";
  method: "GET";
  path: "/profile/me";
  headers: Record<string, string>;
  timeoutMs: number;
}
/** Structural shape of the V1 service client (returns `{ status, data }`, throws on non-2xx / timeout / network error). */
export type ProfileServiceGet = (req: ProfileServiceRequest) => Promise<{ status: number; data: unknown }>;

/** Same per-call budget V1 uses for /profile/me (profile_extractor.ts). */
export const PROFILE_READ_TIMEOUT_MS = 3_000;

const OK = (age: number): ProfileReadResult => ({ status: "PROFILE_OK", age });
const AGE_UNKNOWN: ProfileReadResult = Object.freeze({ status: "AGE_UNKNOWN" });
const DENIED: ProfileReadResult = Object.freeze({ status: "PROFILE_ACCESS_DENIED" });
const UNAVAILABLE: ProfileReadResult = Object.freeze({ status: "PROFILE_UNAVAILABLE" });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** Same validity range as minor-gate.ts / supervisor.ts (integer 1..120). */
const validAge = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 120 ? v : null);

/**
 * Whole years from a date of birth to `nowMs`, in UTC calendar days. UTC is never AHEAD of Vietnam time, so around a birthday
 * this can only report the lower age (the stricter side for Gate 1). Invalid / future dates → null.
 */
export function ageFromDateOfBirth(dob: unknown, nowMs: number): number | null {
  if (typeof dob !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(dob)) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime()) || d.getTime() > nowMs) return null;
  const now = new Date(nowMs);
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return validAge(age);
}

/** Maps a thrown transport error. Only 401/403 are an access decision; everything else is "could not read". */
export function classifyProfileReadError(err: unknown): ProfileReadResult {
  const e = err as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } } | null | undefined;
  const status = Number(e?.response?.status ?? e?.status ?? e?.statusCode);
  return status === 401 || status === 403 ? DENIED : UNAVAILABLE;
}

/**
 * Interprets a 2xx `{ profile: UserProfile | null }` (user-service profile.service.ts getProfile). `profile: null` is a
 * successful read of a user without a saved profile → AGE_UNKNOWN. When both the stored `age` and `dateOfBirth` are valid
 * and disagree, the LOWER age is used (a stale stored age can only make Gate 1 stricter, never looser).
 */
export function interpretProfileResponse(res: unknown, userId: string, nowMs: number): ProfileReadResult {
  if (!isRecord(res)) return UNAVAILABLE;
  const status = Number(res.status);
  if (!(status >= 200 && status < 300)) return status === 401 || status === 403 ? DENIED : UNAVAILABLE;
  const body = res.data;
  if (!isRecord(body) || !("profile" in body)) return UNAVAILABLE;
  const p = body.profile;
  if (p === null) return AGE_UNKNOWN;
  if (!isRecord(p)) return UNAVAILABLE;
  if (p.userId !== undefined && p.userId !== userId) return DENIED;
  const ages = [validAge(p.age), ageFromDateOfBirth(p.dateOfBirth, nowMs)].filter((a): a is number => a !== null);
  return ages.length ? OK(Math.min(...ages)) : AGE_UNKNOWN;
}

export interface ProfileReaderOptions {
  get: ProfileServiceGet;
  /** Per-read budget; also enforced here (the Lambda Invoke transport has no timeout of its own). */
  timeoutMs?: number;
  now?: () => number;
}

/** The supervisor's Gate 1 reader. Never throws; one HTTP read per call (the supervisor calls it once per turn). */
export function createProfileReader(opts: ProfileReaderOptions): SupervisorProfileReader {
  const timeoutMs = Math.max(1, Math.min(opts.timeoutMs ?? PROFILE_READ_TIMEOUT_MS, PROFILE_READ_TIMEOUT_MS));
  const now = opts.now ?? Date.now;
  return async (identity: AuthenticatedToolContext): Promise<ProfileReadResult> => {
    if (!identity || typeof identity.userId !== "string" || !/^\S{1,128}$/.test(identity.userId)) return DENIED;
    const auth = identity.authorizationHeader;
    if (typeof auth !== "string" || !auth.trim()) return DENIED;
    const TIMED_OUT = Symbol("timeout");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const res = await Promise.race([
        Promise.resolve().then(() => opts.get({ service: "user", method: "GET", path: "/profile/me", headers: { Authorization: auth }, timeoutMs })),
        new Promise<typeof TIMED_OUT>((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs); }),
      ]);
      if (res === TIMED_OUT) return UNAVAILABLE;
      return interpretProfileResponse(res, identity.userId, now());
    } catch (err) {
      return classifyProfileReadError(err);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}
