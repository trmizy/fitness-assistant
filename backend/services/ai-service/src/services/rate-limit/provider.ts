/**
 * Selects the rate-limit backend by RATE_LIMIT_PROVIDER:
 *   dynamodb → DynamoDbRateLimiter (AWS Lambda production — see its own doc
 *              comment for why this is the only backend safe across
 *              concurrent Lambda execution environments)
 *   memory   → MemoryRateLimiter (local/Docker development default)
 *   off      → no limiter is constructed at all; rate-limit.middleware.ts
 *              checks for "off" before ever calling getRateLimiter() and
 *              skips straight to next()
 *
 * Defaults to "memory" when unset, restoring at least the same-process
 * protection the old Express gateway's limiter gave — a container/local
 * deployment that never sets this env var is no longer completely
 * unprotected the way ai-service was on its own before this module existed.
 */
import type { RateLimiter } from "./types";
import { MemoryRateLimiter } from "./memory-rate-limiter";
import { DynamoDbRateLimiter } from "./dynamodb-rate-limiter";

export type RateLimitProviderName = "memory" | "dynamodb" | "off";

export function resolveRateLimitProvider(
  env: NodeJS.ProcessEnv = process.env,
): RateLimitProviderName {
  const raw = (env.RATE_LIMIT_PROVIDER ?? "").trim().toLowerCase();
  if (raw === "dynamodb" || raw === "off" || raw === "memory") return raw;
  if (raw) {
    throw new Error(
      `Unsupported RATE_LIMIT_PROVIDER "${raw}". Expected one of: memory, dynamodb, off.`,
    );
  }
  return "memory";
}

let cached: { provider: RateLimitProviderName; limiter: RateLimiter } | undefined;

/** Returns undefined for "off" — callers must check resolveRateLimitProvider()
 * first; this never constructs a limiter that will just be ignored. */
export function getRateLimiter(
  provider: RateLimitProviderName = resolveRateLimitProvider(),
): RateLimiter | undefined {
  if (provider === "off") return undefined;
  if (cached?.provider === provider) return cached.limiter;

  const limiter = provider === "dynamodb" ? new DynamoDbRateLimiter() : new MemoryRateLimiter();
  cached = { provider, limiter };
  return limiter;
}

/** Test-only: forces the next getRateLimiter() call to construct fresh. */
export function resetRateLimiterCache(): void {
  cached = undefined;
}
