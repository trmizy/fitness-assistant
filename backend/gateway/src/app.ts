import express, { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import { logger, register, metricsMiddleware } from "@gym-coach/shared";
import { rateLimiter } from "./middleware/rateLimit.middleware";
import proxyRoutes from "./routes/proxy.routes";
import translateRoutes from "./routes/translate.routes";
import { isAllowedOrigin } from "./utils/corsOrigins";
import { validateInternalSecret } from "./utils/internal-secret";

const app = express();

// Security review 2026-09-03 (C5) — without this, express-rate-limit's default keyGenerator
// (req.ip) resolves to whatever TCP peer dialed us directly: cloudflared in dev, the "web"
// nginx container in prod (see docker-compose.prod.yml) — never the real client. Every real
// user then collapses onto that one proxy IP, so the flat global budget (100 req/min) is
// exhausted by aggregate traffic instead of per-caller, DoS-ing everyone at once. `1` trusts
// exactly one hop of X-Forwarded-For (the immediate proxy in front of us), matching the
// single-hop topology both deployments actually use — not `true` (trust every hop, spoofable
// by the client itself supplying its own X-Forwarded-For).
app.set("trust proxy", 1);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);
app.use(
  cors({
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  }),
);
// Identity headers are gateway-authority ONLY. Strip any client-supplied x-user-*/x-gateway-secret
// on every incoming request so a caller can never inject their own identity/role — authMiddleware
// sets x-user-* from the verified JWT. We also stamp a shared x-gateway-secret so downstream
// services can prove a request actually came through the gateway (defense in depth even if an
// internal port is exposed). Closing the internal ports entirely remains a deployment requirement.
// Security review 2026-09-03 (M6) — validateInternalSecret already existed (tested in
// gateway.secret.test.ts) but was never actually called anywhere, so this fell back to the
// public, in-source-control default in production too if the env var was ever unset. Calling
// it here makes that fail loudly at boot instead of silently trusting a known string.
validateInternalSecret(process.env.INTERNAL_SERVICE_SECRET, process.env.NODE_ENV);
const GATEWAY_SECRET =
  process.env.INTERNAL_SERVICE_SECRET || "dev_internal_service_secret_change_in_production";
app.use((req: Request, _res: Response, next: NextFunction) => {
  delete req.headers["x-user-id"];
  delete req.headers["x-user-email"];
  delete req.headers["x-user-role"];
  delete req.headers["x-gateway-secret"];
  req.headers["x-gateway-secret"] = GATEWAY_SECRET;
  next();
});

// Whatever host:port the caller actually dialed to reach US, right now — the LAN IP on the
// same WiFi, `10.0.2.2` from inside an emulator, or a Cloudflare quick-tunnel's ever-changing
// `https://xxxx.trycloudflare.com` (see Khoi-dong-Tunnel.bat). A payment gateway's own
// return-URL has to be reachable by whichever browser the payer ends up completing checkout
// in, and that browser only ever knows to come back through the SAME door it went out —
// hardcoding one value in `.env` (what this used to do) works for exactly one of those at a
// time. Read directly from the header rather than the now-trust-proxy-aware `req.protocol`
// (C5 added `app.set('trust proxy', 1)` above, for the rate limiter's `req.ip` — it also makes
// `req.protocol` forwarding-aware, but this predates that and there's no reason to churn a
// working block to use it) — cloudflared terminates TLS and forwards plain HTTP internally,
// so the real scheme only ever comes from X-Forwarded-Proto either way.
// Consumed by ai-service/gym-service/user-service's own `detectPlatform`-adjacent checkout
// controllers, same forwarding pattern as x-gateway-secret above.
app.use((req: Request, _res: Response, next: NextFunction) => {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const proto = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)?.split(",")[0]?.trim() || req.protocol;
  // BUG FIX (2026-09-06): req.get("host") alone reflects whatever Host header the request
  // arrived here WITH — correct only when the client reached this gateway directly. Every
  // proxy hop in front of it (the Vite dev-server's own /api proxy locally, an ALB/CloudFront
  // in front of it in a real deployment) rewrites Host to ITS OWN upstream target before
  // forwarding, so req.get("host") silently returns that internal address instead of the
  // one the payer's actual browser is on. Reproduced directly: a real ZaloPay payment through
  // the local web dev server redirected back to the literal Docker-internal
  // "api-gateway:3000", which no browser can ever resolve — money moved, contract stuck
  // PENDING_PAYMENT forever, discovered live during a demo. x-forwarded-proto (above) already
  // gets this right by checking the forwarded header first; host never did. Same fix, same
  // pattern — matched on the frontend side by an explicit X-Forwarded-Host set in
  // vite.config.ts's proxy `configure` hooks, since node-http-proxy's own `xfwd` option (also
  // in that file) forwards -for/-port/-proto but never -host.
  const forwardedHost = req.headers["x-forwarded-host"];
  const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost)?.split(",")[0]?.trim() || req.get("host");
  delete req.headers["x-public-base-url"]; // never trust a client-supplied value, same rule as x-user-*
  if (host) req.headers["x-public-base-url"] = `${proto}://${host}`;
  next();
});

app.use(rateLimiter);
app.use(metricsMiddleware());

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.info({
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get("user-agent"),
  });
  next();
});

app.get("/health", (_req, res) => {
  res.json({
    status: "healthy",
    service: "api-gateway",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

// ── n8n CSP bypass ───────────────────────────────────────────────────────────
// Helmet adds strict CSP / noSniff headers to ALL responses. Strip them for
// every path that proxies to n8n so the editor and its assets load cleanly.
function removeN8nHelmetHeaders(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  res.removeHeader("X-Frame-Options");
  res.removeHeader("Content-Security-Policy");
  res.removeHeader("X-Content-Type-Options");
  next();
}
app.use("/admin/workflows/studio", removeN8nHelmetHeaders);
app.use("/rest", removeN8nHelmetHeaders);
app.use("/assets", removeN8nHelmetHeaders);
app.use("/static", removeN8nHelmetHeaders);
app.use("/signin", removeN8nHelmetHeaders);
app.use("/login", removeN8nHelmetHeaders);

app.use("/", translateRoutes);
app.use("/", proxyRoutes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: { code: "NOT_FOUND", message: "Endpoint not found" },
  });
});

// Global error handler
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ error: err.message, stack: err.stack, path: req.path });
  res.status(err.statusCode || 500).json({
    success: false,
    error: {
      code: err.code || "INTERNAL_ERROR",
      message:
        process.env.NODE_ENV === "production"
          ? "Internal server error"
          : err.message,
    },
  });
});

export default app;
