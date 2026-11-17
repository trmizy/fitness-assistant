import rateLimit from "express-rate-limit";
import type { Request } from "express";

function parsePositiveIntEnv(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const PUBLIC_IMAGE_READ_PREFIXES = [
  "/media/pt-physique/",
  "/media/gym-photos/",
  "/uploads/profile-photos/",
  "/uploads/gym-photos/",
] as const;

/** Public GET/HEAD image reads use their own generous bucket instead of the 100/60s API budget. */
export function isPublicImageReadRequest(req: Pick<Request, "method" | "path">): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  return PUBLIC_IMAGE_READ_PREFIXES.some((prefix) => req.path.startsWith(prefix));
}

export const rateLimiter = rateLimit({
  windowMs: parsePositiveIntEnv(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
  limit: parsePositiveIntEnv(process.env.RATE_LIMIT_MAX_REQUESTS, 100),
  skip: isPublicImageReadRequest,
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

// Separate generous bucket for public gallery/avatar image reads so a single discovery page
// of 20+ cards does not exhaust the shared API budget. Non-GET/HEAD writes still hit rateLimiter.
export const mediaRateLimiter = rateLimit({
  windowMs: parsePositiveIntEnv(process.env.MEDIA_RATE_LIMIT_WINDOW_MS, 60_000),
  limit: () => parsePositiveIntEnv(process.env.MEDIA_RATE_LIMIT_MAX_REQUESTS, 1000),
  skip: (req) => !isPublicImageReadRequest(req),
  message: "Too many media requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter limiter for sensitive /auth/* endpoints (login, register, OTP verification/resend,
// password reset) — the credential-stuffing / spam surface. Session lifecycle calls
// (/auth/verify, /auth/refresh, /auth/logout, /auth/me*) stay under the shared rateLimiter.
export const authRateLimiter = rateLimit({
  windowMs: parsePositiveIntEnv(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 900_000), // 15 min
  limit: parsePositiveIntEnv(process.env.AUTH_RATE_LIMIT_MAX_REQUESTS, 20),
  message: "Too many authentication requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter limiter for /ai/ask and /ai/ask/stream — each request triggers a
// real LLM call with real $ cost, unlike the mostly-cheap CRUD endpoints the
// flat global limiter above is sized for.
export const aiAskRateLimiter = rateLimit({
  windowMs: parsePositiveIntEnv(process.env.AI_ASK_RATE_LIMIT_WINDOW_MS, 60_000),
  limit: parsePositiveIntEnv(process.env.AI_ASK_RATE_LIMIT_MAX_REQUESTS, 20),
  message: "Too many AI requests from this IP, please slow down.",
  standardHeaders: true,
  legacyHeaders: false,
});
