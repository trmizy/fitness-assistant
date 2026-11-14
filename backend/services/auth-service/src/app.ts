import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { logger, httpLogSerializers, register, metricsMiddleware } from "@gym-coach/shared";
import authRoutes from "./routes/auth.routes";

const app = express();

app.disable("x-powered-by");
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
app.use(express.json({ limit: "1mb" }));
app.use(pinoHttp({ logger, serializers: httpLogSerializers }));
app.use(metricsMiddleware());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "auth-service" });
});

app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

app.use("/auth", authRoutes);


// N13A-06: a malformed JSON body (or any other body-parser failure) answers JSON, never Express's default HTML page with the stack trace and server paths.
// The raw body is never logged or echoed back.
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  const e = err as { type?: string; status?: number; statusCode?: number } | null;
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof SyntaxError && e?.status === 400 && "body" in (err as object)) {
    res.status(400).json({ error: "Dữ liệu JSON không hợp lệ", code: "INVALID_JSON" });
    return;
  }
  if (e?.type === "entity.too.large") {
    res.status(413).json({ error: "Dữ liệu gửi lên quá lớn", code: "PAYLOAD_TOO_LARGE" });
    return;
  }
  next(err);
});

export default app;
