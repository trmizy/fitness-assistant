/**
 * Gymini V2 Multi-Agent — cross-service READ transport (M7-P2, part of the approved LOCAL INTEGRATION layer).
 *
 * WHY: four V2 READ deps (Recovery: training window + recent workouts; Progress: body/goal state + training window) used
 * the V1 enterprise-data readers, which call `${FITNESS_SERVICE_URL}` with axios directly — HTTP only (no Lambda path:
 * on AWS the URL is unset and defaults to a docker hostname) and every failure collapsed into {status:"error", message}.
 *
 * WHAT: the SAME endpoints, the SAME identity contract (the user's own Authorization bearer only — fitness-service
 * authMiddleware derives the user from the token; no x-user-id, no shared secret is sent), the SAME ok/absent semantics
 * (404 → absent, empty list → absent) and the same structural guards, but over the V1 service client `requestService`
 * (clients/service-lambda.client.ts): plain HTTP when FITNESS_LAMBDA_NAME is unset (local), direct Lambda Invoke with a
 * synthetic API Gateway v2 event when it is set (AWS) — the transport every other ai-service → fitness call already uses.
 * Failures are THROWN as DomainReadError with a typed kind taken from the transport's status / error code — never parsed
 * from message text.
 *
 * Boundaries: a fixed operation allowlist (GET only, constant paths, Zod-validated inputs); no caller-supplied URL,
 * path, method or header; one request per call (no retry here — the AWS SDK's own bounded default applies to Invoke);
 * a hard timeout on both transports (the Lambda path has no client timeout of its own). Nothing is logged.
 */
import { z } from "zod";
import { requestService, type ServiceResponse } from "../clients/service-lambda.client";
import { absent, ok, type AuthoritativeRead, type BodyGoalStateWindow, type TrainingAnalyticsWindow } from "../services/enterprise-data/types";

export type DomainReadErrorKind = "ACCESS_DENIED" | "NOT_FOUND" | "UNAVAILABLE" | "TIMEOUT" | "INVALID_RESPONSE" | "CONFIGURATION_ERROR";

/** Thrown by every V2 READ adapter. `status` mirrors the kind for status-based consumers (the tool registry). */
export class DomainReadError extends Error {
  readonly kind: DomainReadErrorKind;
  readonly status: number;
  constructor(kind: DomainReadErrorKind, status: number) {
    super(`domain read failed (${kind})`);
    this.name = "DomainReadError";
    this.kind = kind;
    this.status = status;
  }
}
const STATUS_OF: Record<DomainReadErrorKind, number> = { ACCESS_DENIED: 403, NOT_FOUND: 404, UNAVAILABLE: 503, TIMEOUT: 504, INVALID_RESPONSE: 502, CONFIGURATION_ERROR: 500 };
export const readError = (kind: DomainReadErrorKind, status = STATUS_OF[kind]) => new DomainReadError(kind, status);

/**
 * Typed classification of a transport failure. Sources, in order: an HTTP status (axios `response.status` on the HTTP
 * path; `status`/`response.status` set by throwForLambdaHttpError on the Invoke path); a client error code (axios
 * ECONNABORTED/ETIMEDOUT → TIMEOUT, ECONNREFUSED/ENOTFOUND/ERR_NETWORK… → UNAVAILABLE); an AWS SDK error name
 * (ResourceNotFound / IAM AccessDenied / missing region or credentials → CONFIGURATION_ERROR — the CALLER is
 * misconfigured, not the user refused; throttling / service errors → UNAVAILABLE; TimeoutError → TIMEOUT). Unknown → UNAVAILABLE.
 */
export function classifyTransportError(err: unknown): DomainReadError {
  if (err instanceof DomainReadError) return err;
  const e = err as { response?: { status?: unknown }; status?: unknown; code?: unknown; name?: unknown } | null | undefined;
  const status = Number(e?.response?.status ?? e?.status);
  if (Number.isInteger(status) && status >= 400) {
    if (status === 401 || status === 403) return readError("ACCESS_DENIED", status);
    if (status === 404) return readError("NOT_FOUND", 404);
    if (status === 408 || status === 504) return readError("TIMEOUT", status);
    if (status >= 500) return readError("UNAVAILABLE", status);
    return readError("INVALID_RESPONSE", status); // 400/409/422/429…: the request or the answer did not fit the contract
  }
  const code = String(e?.code ?? "");
  if (code === "ECONNABORTED" || code === "ETIMEDOUT") return readError("TIMEOUT");
  if (/^(ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|ERR_NETWORK|EPIPE)$/.test(code)) return readError("UNAVAILABLE");
  const name = String(e?.name ?? "");
  if (/^(ResourceNotFoundException|AccessDeniedException|AccessDenied|UnrecognizedClientException|InvalidSignatureException|CredentialsProviderError|ExpiredTokenException)$/.test(name) || /Region is missing/i.test(String((err as Error)?.message ?? ""))) {
    return readError("CONFIGURATION_ERROR");
  }
  if (name === "TimeoutError") return readError("TIMEOUT");
  if (err instanceof SyntaxError) return readError("INVALID_RESPONSE"); // a non-JSON Lambda payload body
  return readError("UNAVAILABLE");
}

// ── structural guards (same acceptance as the V1 enterprise-data readers; a malformed body is an error, never "no data") ──
const QUALITIES = new Set(["SUFFICIENT", "PARTIAL", "INSUFFICIENT_HISTORY", "NO_DATA", "STALE"]);
const isTrainingWindow = (v: any): v is TrainingAnalyticsWindow => v != null && typeof v === "object" && v.period && typeof v.period.days === "number"
  && v.adherence && (v.adherence.state === "NO_SCHEDULE" || v.adherence.state === "MEASURED") && v.frequency && v.volume && v.progression
  && Array.isArray(v.progression.exercises) && Array.isArray(v.signals) && QUALITIES.has(v.dataQuality);
const isBodyGoalState = (v: any): v is BodyGoalStateWindow => v != null && typeof v === "object" && typeof v.lookbackDays === "number"
  && v.body && QUALITIES.has(v.body.dataQuality) && v.body.observations && typeof v.body.observations.totalOnRecord === "number" && v.body.trends && v.body.trends.weight
  && v.goal && v.goal.currentTarget && v.goal.gap && v.goal.trajectory && v.goal.trajectory.onTrack && v.goal.roadmap && QUALITIES.has(v.goal.dataQuality);

/** The ONLY reads this adapter can perform. Paths are constants; inputs are validated; GET only. */
export const READ_OPERATIONS = Object.freeze({
  "fitness.training_window": { path: "/stats/training-window", timeoutMs: 3_500, input: z.object({ days: z.number().int().min(7).max(90).optional() }).strict(),
    params: (i: { days?: number }) => (i.days != null ? { days: i.days } : undefined) },
  "fitness.recent_workouts": { path: "/workouts", timeoutMs: 3_500, input: z.object({ limit: z.number().int().min(1).max(20) }).strict(),
    params: (i: { limit: number }) => ({ limit: i.limit }) },
  "fitness.body_goal_state": { path: "/stats/body-goal-state", timeoutMs: 5_000, input: z.object({ lookbackDays: z.number().int().min(7).max(365).optional() }).strict(),
    params: (i: { lookbackDays?: number }) => (i.lookbackDays != null ? { lookbackDays: i.lookbackDays } : undefined) },
});
export type ReadOperationId = keyof typeof READ_OPERATIONS;

export type ServiceRequester = (req: { service: "fitness"; method: "GET"; path: string; params?: Record<string, unknown>; headers: Record<string, string>; timeoutMs: number }) => Promise<ServiceResponse<unknown>>;
export interface ReadIdentity { userId: string; authorizationHeader?: string }

export interface DomainReadTransportOptions {
  /** Default: the V1 service client (HTTP locally, Lambda Invoke when FITNESS_LAMBDA_NAME is set). */
  request?: ServiceRequester;
}

export function createDomainReadTransport(o: DomainReadTransportOptions = {}) {
  const request: ServiceRequester = o.request ?? ((req) => requestService(req));

  /** One allowlisted GET with the user's own bearer. Returns the body; throws DomainReadError. */
  async function get(op: ReadOperationId, identity: ReadIdentity, rawInput: unknown): Promise<{ status: number; data: unknown }> {
    const spec = READ_OPERATIONS[op] as { path: string; timeoutMs: number; input: z.ZodTypeAny; params: (i: any) => Record<string, unknown> | undefined } | undefined;
    if (!spec) throw readError("CONFIGURATION_ERROR"); // not an allowlisted operation
    const auth = identity?.authorizationHeader;
    if (typeof auth !== "string" || !/^Bearer \S+$/.test(auth)) throw readError("ACCESS_DENIED", 401); // never sent without the user's own token
    const input = spec.input.safeParse(rawInput ?? {});
    if (!input.success) throw readError("INVALID_RESPONSE", 400);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const TIMED_OUT = Symbol("timeout");
    try {
      const res = await Promise.race([
        Promise.resolve().then(() => request({ service: "fitness", method: "GET", path: spec.path, params: spec.params(input.data), headers: { Authorization: auth }, timeoutMs: spec.timeoutMs })),
        new Promise<typeof TIMED_OUT>((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), spec.timeoutMs); }),
      ]);
      if (res === TIMED_OUT) throw readError("TIMEOUT");
      if (!res || typeof res !== "object" || !Number.isInteger((res as any).status)) throw readError("INVALID_RESPONSE");
      return res as { status: number; data: unknown };
    } catch (err) {
      throw classifyTransportError(err);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  /** 404 is "nothing recorded" for these three reads (V1 reader contract); every other failure stays an error. */
  const absentOn404 = async <T>(work: () => Promise<AuthoritativeRead<T>>): Promise<AuthoritativeRead<T>> => {
    try { return await work(); } catch (err) { if (err instanceof DomainReadError && err.kind === "NOT_FOUND") return absent("FITNESS_SERVICE"); throw err; }
  };

  return {
    /** Same signature as enterprise-data trainingReader.getTrainingAnalytics. */
    getTrainingAnalytics: (identity: ReadIdentity, range: { days?: number } = {}) => absentOn404<TrainingAnalyticsWindow>(async () => {
      const { data } = await get("fitness.training_window", identity, range);
      if (!isTrainingWindow(data)) throw readError("INVALID_RESPONSE");
      return ok(data, "FITNESS_SERVICE");
    }),
    /** Same signature as enterprise-data workoutReader.getRecentWorkoutHistory. */
    getRecentWorkoutHistory: (identity: ReadIdentity, limit = 20) => absentOn404<Record<string, unknown>[]>(async () => {
      const { data } = await get("fitness.recent_workouts", identity, { limit });
      const body = (data as any)?.data ?? data;
      if (!Array.isArray(body) && !Array.isArray(body?.workouts)) throw readError("INVALID_RESPONSE");
      const rows = (Array.isArray(body) ? body : body.workouts) as Record<string, unknown>[];
      return rows.length ? ok(rows, "FITNESS_SERVICE") : absent("FITNESS_SERVICE");
    }),
    /** Same signature as enterprise-data bodyGoalReader.getBodyGoalState. */
    getBodyGoalState: (identity: ReadIdentity, range: { lookbackDays?: number } = {}) => absentOn404<BodyGoalStateWindow>(async () => {
      const { data } = await get("fitness.body_goal_state", identity, range);
      if (!isBodyGoalState(data)) throw readError("INVALID_RESPONSE");
      return ok(data, "FITNESS_SERVICE");
    }),
  };
}
export type DomainReadTransport = ReturnType<typeof createDomainReadTransport>;

/**
 * Caller-side guard for the two Training READs that hit fitness /internal/* (muscle profiles, plan-equipment check):
 * those need x-internal-token = INTERNAL_SERVICE_SECRET, which the V1 domain client sends as "" when the variable is
 * unset. Without a configured secret the call is refused here (CONFIGURATION_ERROR) instead of sending an empty token.
 */
export function requireInternalSecret<A extends unknown[], R>(fn: (...a: A) => Promise<R>, env: Record<string, string | undefined> = process.env): (...a: A) => Promise<R> {
  return async (...a: A) => {
    const s = env.INTERNAL_SERVICE_SECRET;
    if (typeof s !== "string" || s.trim() === "") throw readError("CONFIGURATION_ERROR");
    try { return await fn(...a); } catch (err) { throw classifyTransportError(err); }
  };
}
