import express, { Express, Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import { logger, register, metricsMiddleware } from "@gym-coach/shared";
import chatRoutes from "./routes/chat.routes";
import callRoutes from "./routes/call.routes";
import { getIo } from "./socket/index";
import { callService } from "./services/call.service";

const app: Express = express();

app.use(helmet());
// No CORS middleware in local dev/docker-compose: this service is only reached via
// backend/gateway's own Express proxy there, which already sets origin-scoped CORS
// headers on the proxied response — adding a second, independent set here (even with
// an identical origin value) can leave the browser looking at two
// Access-Control-Allow-Origin headers on the same response and rejecting it outright.
//
// AWS deployment readiness fix: on AWS, Chat's REST endpoints sit directly behind its
// own ALB (see docs/CHAT_SERVICE_AWS_DEPLOYMENT_PLAN.md) — there is no Express gateway
// proxy in front of it there, so nothing else will ever set that header, and the
// browser blocks every cross-origin REST call without it. `ENABLE_REST_CORS` is a new,
// deliberately separate flag from `CORS_ORIGIN` (already used by Socket.IO's own CORS
// config below) precisely so enabling it is an explicit, AWS-only opt-in that changes
// nothing about the existing local dev/docker-compose behavior by default.
if (process.env.ENABLE_REST_CORS === "true") {
  app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:5173", credentials: true }));
}
app.use(express.json());
app.use(metricsMiddleware());

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.info({ method: req.method, path: req.path, ip: req.ip });
  next();
});

app.get("/health", (_req, res) => {
  res.json({
    status: "healthy",
    service: "chat-service",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

app.use("/chat", chatRoutes);
// REST signaling for video/voice calls; mount under the same /chat prefix so the
// gateway proxy for /chat catches it automatically.
app.use("/chat/calls", callRoutes);

// Internal notification push — validated by shared secret (Docker-internal only)
app.post("/internal/push-notification", (req: Request, res: Response): void => {
  const secret = req.headers["x-internal-secret"];
  if (!secret || secret !== process.env.INTERNAL_API_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const io = getIo();
  if (!io) {
    res.status(503).json({ error: "Socket not ready" });
    return;
  }

  const { userId, adminBroadcast, notification } = req.body;
  if (!notification) {
    res.status(400).json({ error: "Missing notification" });
    return;
  }

  if (adminBroadcast) {
    io.to("admin:notifications").emit("notification:new", notification);
  } else if (userId) {
    io.to(`user:${userId}`).emit("notification:new", notification);
  } else {
    res.status(400).json({ error: "Missing userId or adminBroadcast" });
    return;
  }

  res.json({ ok: true });
  return;
});

// Open-room sessions: force-ends a lingering CallSession row once user-service's own sweep
// has resolved the coaching session it belongs to — see call.service.ts's
// endCallsForCoachingSession doc comment. Best-effort, fire-and-forget from the caller's side.
app.post("/internal/calls/end-by-session", async (req: Request, res: Response): Promise<void> => {
  const secret = req.headers["x-internal-secret"];
  if (!secret || secret !== process.env.INTERNAL_API_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { coachingSessionId, reason } = req.body;
  if (!coachingSessionId) {
    res.status(400).json({ error: "Missing coachingSessionId" });
    return;
  }

  try {
    await callService.endCallsForCoachingSession(coachingSessionId, reason || "session_window_closed");
    res.json({ ok: true });
  } catch (err: any) {
    logger.error({ error: err.message, coachingSessionId }, "end-by-session failed");
    res.status(500).json({ error: "Failed to end call" });
  }
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// Global error handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ error: err.message, stack: err.stack });
  res
    .status(err.statusCode || 500)
    .json({ error: err.message || "Internal server error" });
});

export default app;
