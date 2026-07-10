import express, { Express, Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import { logger, register, metricsMiddleware } from "@gym-coach/shared";
import chatRoutes from "./routes/chat.routes";
import callRoutes from "./routes/call.routes";
import { getIo } from "./socket/index";

const app: Express = express();

app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    credentials: true,
  }),
);
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
