import { createRateLimiter, type RateLimitOptions } from "./rate-limit.middleware";
import { positiveIntEnv } from "../utils/env-int";

/**
 * The per-user budgets for every billable model route, defined once. A bucket's identity is its
 * `name` (the limiter key is `<name>:<userId>`), so two routes share a budget exactly when they
 * use the same limiter here — defining max/window per route file let the same bucket drift.
 *
 * All three must be mounted after `requireAuth`: the key comes from `req.context.userId`, which is
 * either a verified JWT subject or an `x-user-id` accepted only because the caller proved
 * INTERNAL_SERVICE_SECRET. A request-body `userId` is never used for quota attribution.
 */
function intEnv(name: string, fallback: string): number {
  return positiveIntEnv(name, Number.parseInt(fallback, 10));
}

/** Lightweight chat: POST /ai/ask, /ai/ask/stream. */
export const askRateLimiter = createRateLimiter({
  name: "ai-ask",
  max: intEnv("AI_ASK_RATE_LIMIT_MAX", "20"),
  windowSeconds: intEnv("AI_ASK_RATE_LIMIT_WINDOW_SECONDS", "60"),
});

/**
 * Expensive generation: quick workouts, vision routes, AND every plan generate/adjust/explain
 * route and marketplace improvement suggestions. One shared bucket on purpose — otherwise
 * exhausting /ai/generate-workout and switching to /plans/workout/generate would be a second,
 * unmetered allowance.
 */
export const expensiveBudget: RateLimitOptions = {
  name: "ai-expensive",
  max: intEnv("AI_EXPENSIVE_RATE_LIMIT_MAX", "10"),
  windowSeconds: intEnv("AI_EXPENSIVE_RATE_LIMIT_WINDOW_SECONDS", "60"),
};
export const expensiveRateLimiter = createRateLimiter(expensiveBudget);

/**
 * Service-originated model calls made on behalf of a user (cycle analysis, roadmap/plan drafts,
 * progression explanation). Keyed by the originating user fitness-service reports in `x-user-id`,
 * so a user hammering a fitness-service endpoint that fans out to the model is bounded here too.
 * Deliberately more generous than "ai-expensive": these are advisory calls triggered by normal
 * app use, and fitness-service already degrades gracefully when ai-service refuses one.
 */
export const internalAiRateLimiter = createRateLimiter({
  name: "ai-internal",
  max: intEnv("AI_INTERNAL_RATE_LIMIT_MAX", "30"),
  windowSeconds: intEnv("AI_INTERNAL_RATE_LIMIT_WINDOW_SECONDS", "60"),
});
