/**
 * In-process fixed-window counter — local/Docker development only. A single
 * Express process has one Node.js event loop, so `consume()` mutates its Map
 * synchronously with no `await` in between reading and writing the counter;
 * that ordering (not any lock) is what makes it race-safe for concurrent
 * requests within one process. It shares nothing across processes, which is
 * exactly why Lambda uses the DynamoDB backend instead (see
 * dynamodb-rate-limiter.ts's doc comment).
 *
 * "Local memory provider may remain simple" (per the rate-limit spec this
 * implements) — there is no I/O here to fail, so there is no infra-error /
 * fail-closed case to handle; the RateLimiter interface's `consume` simply
 * never rejects.
 */
import type { RateLimiter, RateLimitParams, RateLimitResult } from "./types";

interface Bucket {
  count: number;
  windowStart: number;
}

// Bounds unbounded growth in a long-lived dev process across many distinct
// keys/windows. Not a correctness mechanism — an evicted bucket simply starts
// a fresh count next request, same as if TTL had already reclaimed it.
const MAX_BUCKETS = 10_000;

export class MemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  async consume({ key, max, windowSeconds }: RateLimitParams): Promise<RateLimitResult> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const windowStart = Math.floor(nowSeconds / windowSeconds) * windowSeconds;
    const bucketKey = `${key}:${windowStart}`;

    const existing = this.buckets.get(bucketKey);
    const count = (existing?.windowStart === windowStart ? existing.count : 0) + 1;
    this.buckets.set(bucketKey, { count, windowStart });

    if (this.buckets.size > MAX_BUCKETS) this.evictExpired(nowSeconds);

    return {
      allowed: count <= max,
      count,
      max,
      retryAfterSeconds: windowStart + windowSeconds - nowSeconds,
    };
  }

  private evictExpired(nowSeconds: number): void {
    // Every window used by this service is well under an hour, so any
    // bucket whose window started over an hour ago is long past being
    // incremented again — safe to drop regardless of its own window size.
    for (const [bucketKey, bucket] of this.buckets) {
      if (nowSeconds - bucket.windowStart > 3600) this.buckets.delete(bucketKey);
    }
  }

  /** Test-only: drops all counters so suites don't leak state across cases. */
  reset(): void {
    this.buckets.clear();
  }
}
