import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { logger, register, metricsMiddleware } from "@gym-coach/shared";
import authRoutes from "./routes/auth.routes";

const app = express();

app.use(helmet());
// No CORS middleware here on purpose: this service is only ever reached
// server-to-server (via the gateway's proxy, or directly from other backend
// services like chat-service's token-verify call) — never directly by a
// browser. A no-args cors() previously set a blanket
// Access-Control-Allow-Origin: * here, which http-proxy-middleware forwards
// upstream headers through as-is, so it was clobbering the gateway's own
// carefully origin-scoped CORS header (which reflects a specific allowed
// origin + Access-Control-Allow-Credentials: true) with an invalid
// wildcard-plus-credentials combination once proxied back to the browser.
app.use(express.json());
app.use(pinoHttp({ logger }));
app.use(metricsMiddleware());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "auth-service" });
});

app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

app.use("/auth", authRoutes);

export default app;
