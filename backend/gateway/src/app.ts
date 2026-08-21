import express, { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import { logger, register, metricsMiddleware } from "@gym-coach/shared";
import { rateLimiter } from "./middleware/rateLimit.middleware";
import proxyRoutes from "./routes/proxy.routes";
import translateRoutes from "./routes/translate.routes";
import { isAllowedOrigin } from "./utils/corsOrigins";

const app = express();

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
