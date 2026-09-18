/**
 * Fixed-window per-key rate limiter, shared contract for every backend
 * (memory, DynamoDB). "Fixed window" means the window boundary is derived
 * from wall-clock time (`floor(now / windowSeconds) * windowSeconds`), not
 * from when the caller's first request happened — so the window a given
 * request falls into is the same no matter which backend answers it.
 */
export interface RateLimitParams {
  /** Caller-scoped key, e.g. `ai-ask:<userId>`. Never a raw client header. */
  key: string;
  max: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Count AFTER this request was recorded (i.e. this request's own ordinal
   * in the window — the 21st request in a max=20 window reports 21). */
  count: number;
  max: number;
  /** Seconds until the current fixed window ends and a fresh one begins. */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  /**
   * Atomically records one request for `key`'s current window and reports
   * whether it is within `max`. Must never do read-count → increment →
   * write-count as three separate steps — that is race-prone across
   * concurrent callers (concurrent Lambda execution environments, for the
   * DynamoDB backend). Throws RateLimitInfrastructureError when the count
   * cannot be determined at all (vs. a normal "over limit" result, which is
   * a resolved value, not a throw).
   */
  consume(params: RateLimitParams): Promise<RateLimitResult>;
}

/**
 * The limiter's own storage could not be reached or answered unexpectedly —
 * distinct from "over limit" (a successful answer of "no"). Middleware
 * decides what to do with this (see rate-limit.middleware.ts): AI routes
 * fail closed rather than let an unlimited number of billed Bedrock calls
 * through while the limiter is blind.
 */
export class RateLimitInfrastructureError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "RateLimitInfrastructureError";
  }
}
