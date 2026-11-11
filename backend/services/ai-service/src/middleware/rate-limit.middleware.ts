/**
 * Per-user rate limiting for ai-service's directly-Bedrock-calling,
 * end-user-reachable routes — restores the protection the old Express
 * gateway's `aiAskRateLimiter` gave for `/ai/ask` and `/ai/ask/stream`, now
 * that traffic can reach this service's Lambda directly (API Gateway → AI
 * Lambda → Bedrock), with no gateway process in between to hold that state.
 *
 * MUST be mounted after `requireAuth` on every route it protects.
 * `req.context.userId` is only trustworthy once requireAuth has run — it is
 * either the subject of a Bearer JWT this service verified itself against
 * auth-service, or an `x-user-id` claim accepted only because the caller
 * separately proved knowledge of INTERNAL_SERVICE_SECRET (see
 * auth.middleware.ts's own doc comment on that trust model). This file never
 * reads `x-user-id` / `x-user-role` itself — only `req.context`, already
 * resolved by requireAuth — so a request that fails auth never reaches here,
 * and a browser cannot obtain a second quota by sending a different
 * `x-user-id` header: with no valid Bearer token and no internal token, that
 * request is already rejected 401 upstream; with a valid Bearer token, the
 * key is the verified subject regardless of what any header claims.
 *
 * Fail-closed on infrastructure error (§7 of the rate-limit spec this
 * implements): every route this middleware protects calls a billed Bedrock
 * model if the request is allowed through. If RATE_LIMIT_PROVIDER=dynamodb
 * is configured but the limiter cannot be evaluated (DynamoDB unreachable,
 * permission error, malformed response), the safe default is to refuse the
 * request with a sanitized 503 — never to silently fall back to "allow",
 * which would mean an infrastructure outage turns into unlimited Bedrock
 * spend. The `memory` and `off` providers have no such failure mode to
 * handle (see their own files).
 */
import { Request, Response, NextFunction, RequestHandler } from "express";
import { logger } from "@gym-coach/shared";
import { ApiError, RateLimitUnavailableError, RateLimitedError } from "../errors/api-error";
import { RateLimitInfrastructureError } from "../services/rate-limit/types";
import { getRateLimiter, resolveRateLimitProvider } from "../services/rate-limit/provider";

export interface RateLimitOptions {
  /** Bucket name, prefixed onto the key — distinct routes/tiers never share
   * a counter even for the same user (e.g. "ai-ask" vs "ai-expensive"). */
  name: string;
  max: number;
  windowSeconds: number;
}

/**
 * The limiter core as a throwing function, so a DOMAIN COMMAND (e.g. the queue*Generation commands)
 * can admit a billable operation with the same bucket, key (`<name>:<verifiedUserId>`), fixed-window
 * semantics and fail-closed behavior as the route middleware below. Throws RateLimitedError (429),
 * RateLimitUnavailableError (503) or ApiError 401; resolves when the operation is admitted.
 * `userId` must come from req.context / a verified identity, never a request body.
 */
export async function consumeRateLimit(
  options: RateLimitOptions,
  userId: string | undefined,
): Promise<void> {
  const provider = resolveRateLimitProvider();
  if (provider === "off") return;

  if (!userId) {
    // Refusing outright (rather than silently allowing) keeps a future routing mistake from ever
    // granting an unmetered, unlimited quota.
    throw new ApiError("UNAUTHORIZED", "Rate limiting requires an authenticated identity", 401);
  }

  const limiter = getRateLimiter(provider);
  if (!limiter) return;

  try {
    const result = await limiter.consume({
      key: `${options.name}:${userId}`,
      max: options.max,
      windowSeconds: options.windowSeconds,
    });
    if (!result.allowed) {
      const retryAfterSeconds = Math.max(1, result.retryAfterSeconds);
      throw new RateLimitedError(`Too many requests. Try again in ${retryAfterSeconds}s.`, retryAfterSeconds);
    }
  } catch (err) {
    if (err instanceof RateLimitInfrastructureError) {
      logger.error(
        { err: err.message, name: options.name, userId },
        "[rate-limit] limiter unavailable — failing closed for a Bedrock-calling route",
      );
      // Deliberately RateLimitUnavailableError, not the underlying err — its message never reaches
      // the client (no DynamoDB table name, region, or AWS error text in the response body).
      throw new RateLimitUnavailableError();
    }
    throw err;
  }
}

export function createRateLimiter(options: RateLimitOptions): RequestHandler {
  return async function rateLimitMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      await consumeRateLimit(options, req.context?.userId);
    } catch (err) {
      if (err instanceof RateLimitedError) {
        res.setHeader("Retry-After", String(err.retryAfterSeconds));
      }
      next(err);
      return;
    }
    next();
  };
}
