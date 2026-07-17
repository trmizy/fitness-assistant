import rateLimit from "express-rate-limit";

const N8N_RATE_LIMIT_BYPASS_PREFIXES = [
  "/admin/workflows/studio",
  "/rest",
  "/assets",
  "/static",
  "/signin",
];

export const rateLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000"),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "100"),
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) =>
    N8N_RATE_LIMIT_BYPASS_PREFIXES.some((prefix) =>
      req.path.startsWith(prefix),
    ),
});

// Stricter limiter for /auth/* (login, register, password reset) — the
// classic brute-force/credential-stuffing surface. The flat global budget
// above (100 req/min, shared with every other endpoint) is far too loose to
// meaningfully slow down a credential-stuffing attempt.
export const authRateLimiter = rateLimit({
  windowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || "900000"), // 15 min
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX_REQUESTS || "20"),
  message: "Too many authentication requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter limiter for /ai/ask and /ai/ask/stream — each request triggers a
// real LLM call with real $ cost, unlike the mostly-cheap CRUD endpoints the
// flat global limiter above is sized for.
export const aiAskRateLimiter = rateLimit({
  windowMs: parseInt(process.env.AI_ASK_RATE_LIMIT_WINDOW_MS || "60000"),
  max: parseInt(process.env.AI_ASK_RATE_LIMIT_MAX_REQUESTS || "20"),
  message: "Too many AI requests from this IP, please slow down.",
  standardHeaders: true,
  legacyHeaders: false,
});
