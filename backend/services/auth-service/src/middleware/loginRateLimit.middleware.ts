import { Request, Response, NextFunction } from "express";

// Minimal in-memory rate limiter for /auth/login (BUG-021 / TC-SEC-01).
// - Keyed by ip + email (or ip alone if email missing).
// - Counts only FAILED attempts (success → decrement). Brute-force protection
//   triggers on repeated wrong passwords without penalizing real users that log
//   in normally many times (e.g. multiple tabs, automated test harness).
// - 5 failed attempts per 15-minute window → 429.
// - In-memory Map: single-instance MVP. Move to Redis later for multi-instance.
// Intentionally does NOT pull a new npm dep — keeps package.json untouched.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const buckets = new Map<string, { count: number; resetAt: number }>();

function keyFor(req: Request): string {
  const ip = (req.ip || req.headers["x-forwarded-for"] || "unknown")
    .toString()
    .split(",")[0]
    .trim();
  const email = (req.body?.email || "").toString().toLowerCase();
  return `${ip}|${email}`;
}

export function loginRateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // Periodic GC so the map can't grow unbounded.
  if (buckets.size > 5000) {
    const now = Date.now();
    for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
  }
  const k = keyFor(req);
  const now = Date.now();
  const bucket = buckets.get(k);

  // Hard block: already over the limit and window still open.
  if (bucket && bucket.resetAt > now && bucket.count >= MAX_ATTEMPTS) {
    const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader("Retry-After", String(retryAfterSec));
    return res.status(429).json({
      error: `Quá nhiều lần đăng nhập sai, thử lại sau ${retryAfterSec}s`,
    });
  }

  // Pre-emptively count this attempt; we'll roll it back on `finish` if the auth
  // controller responds with 200 (successful login). This way only FAILED logins
  // (401 / 403 etc.) accumulate.
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(k, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    bucket.count += 1;
  }

  res.on("finish", () => {
    const after = buckets.get(k);
    if (!after) return;
    if (res.statusCode >= 200 && res.statusCode < 300) {
      // Success — don't penalize.
      after.count = Math.max(0, after.count - 1);
      if (after.count === 0 && after.resetAt > now) buckets.delete(k);
    }
  });

  return next();
}
