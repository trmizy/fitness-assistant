import { Request, Response, NextFunction } from "express";

// Rate limit for the unauthenticated endpoints that SEND AN EMAIL on request —
// POST /auth/register/resend (GAP-5) and POST /auth/password-reset/request (GAP-4).
//
// Unlike loginRateLimit, which only counts failures, every request counts here: each one can put
// a message in someone's inbox, so a "success" is exactly the thing being limited.
// - Keyed by scope + ip + email. Behind the gateway `req.ip` is the gateway's own address for
//   every caller, so in practice this is a per-email ceiling — which is the property that matters:
//   nobody can flood one inbox. The per-email cooldown inside authService (one send per minute) is
//   the finer-grained guard; this caps the longer window.
// - 5 requests per 15 minutes → 429 with Retry-After.
// - In-memory Map: single-instance MVP, same deliberate trade-off as loginRateLimit.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 5;

export function createEmailActionRateLimit(scope: string) {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return function emailActionRateLimit(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    const now = Date.now();
    // Periodic GC so the map can't grow unbounded.
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }

    const ip = (req.ip || req.headers["x-forwarded-for"] || "unknown")
      .toString()
      .split(",")[0]
      .trim();
    const email = (req.body?.email || "").toString().trim().toLowerCase();
    const key = `${scope}|${ip}|${email}`;
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
      return next();
    }

    if (bucket.count >= MAX_REQUESTS) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      return res.status(429).json({
        error: `Bạn đã yêu cầu quá nhiều lần, thử lại sau ${retryAfterSec}s`,
      });
    }

    bucket.count += 1;
    return next();
  };
}
