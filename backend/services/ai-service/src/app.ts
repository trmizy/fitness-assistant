import express, { Request, Response, NextFunction } from "express";
import { metricsMiddleware, register, logger } from "@gym-coach/shared";
import aiRoutes from "./routes/ai.routes";
import planRoutes from "./routes/plan.routes";
import adminAiRoutes from "./routes/admin.routes";
import internalRoutes from "./routes/internal.routes";
import marketplaceRoutes from "./routes/marketplace.routes";
import personalizedServiceRoutes from "./routes/personalized-service.routes";
import adminMarketplaceRoutes from "./routes/admin-marketplace.routes";
import { ApiError, RateLimitedError, formatErrorResponse } from "./errors/api-error";
import { llmService } from "./services/llm.service";

const app = express();

// Reproduced live on AWS DEV, 2026-09-30 (AI CORS/preflight audit): the API Gateway HTTP API's
// CorsConfiguration only decorates whatever the Lambda returns with access-control-* headers —
// it does NOT auto-answer the OPTIONS preflight itself, because the `ANY /plans/{proxy+}` /
// `ANY /ai/{proxy+}` routes already match OPTIONS and forward it to this Lambda. Every route
// here mounts `router.use(requireAuth)` first, and a browser's OPTIONS preflight never carries
// an Authorization header, so the preflight hit requireAuth and got a 401 (confirmed via curl
// with the real frontend origin: CORS headers were present, status was 401). A non-2xx
// preflight response makes the browser abort the real request even though the CORS headers
// look correct — so every authenticated GET/POST from the real frontend origin was silently
// blocked by CORS in any browser, invisible to a plain curl/Postman test that skips OPTIONS.
// Short-circuiting OPTIONS here, before any router (and before requireAuth), fixes this without
// touching auth logic — API Gateway still adds the real CORS headers on top of this 204.
app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// Both photo endpoints take the image as base64 JSON (≤4 MB raw → ~5.4 MB encoded). image-chat was
// missing here and fell to express.json()'s 100 KB default, so any real photo was refused before
// reaching the handler (MOBILE_BACKEND_GAPS.md GAP-18).
app.use("/ai/agent/goal-image", express.json({ limit: "6mb" }));
app.use("/ai/agent/image-chat", express.json({ limit: "6mb" }));
app.use(express.json());
app.use(metricsMiddleware());

// Health endpoint, including Qdrant availability status.
// qdrantAvailable is set by server.ts at startup and exported so tests can mock.
export let qdrantAvailable = false;
export function setQdrantAvailable(available: boolean): void {
  qdrantAvailable = available;
  logger.info({ available }, "Qdrant availability state updated");
}

app.get("/health", async (_req, res) => {
  const llm = await llmService.getHealthStatus();
  res.json({
    status: "ok",
    service: "ai-service",
    retrieval: qdrantAvailable ? "available" : "degraded",
    llmAvailable: llm.llmAvailable,
    llmProvider: llm.llmProvider,
    llmUrl: llm.llmUrl,
    llm,
  });
});

app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

app.use("/ai", aiRoutes);
app.use("/plans", planRoutes);
// Registered BEFORE the generic /admin/ai mount so /admin/ai/marketplace/* is matched first.
app.use("/admin/ai/marketplace", adminMarketplaceRoutes);
app.use("/admin/ai", adminAiRoutes);
app.use("/marketplace", marketplaceRoutes);
// Personalized PT Service — distinct product from marketplaceRoutes'
// PublishedPlan/TrainingPackage (fixed-plan) listings. Same base path
// ("/marketplace") since it's conceptually part of the same marketplace;
// route names (/services, /orders) don't collide with marketplaceRoutes'
// (/plans, /packages).
app.use("/marketplace", personalizedServiceRoutes);
app.use("/internal", internalRoutes);

// Global error handler.
// Must have 4 parameters so Express recognises it as an error-handling middleware.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) {
    // A rate-limit refusal raised by a domain command (not the route middleware) still owes the client Retry-After.
    if (err instanceof RateLimitedError) res.setHeader("Retry-After", String(err.retryAfterSeconds));
    res.status(err.statusCode).json(err.toJSON());
    return;
  }
  // body-parser's own error for an over-limit body — a client error, not a server fault.
  if ((err as { type?: string })?.type === "entity.too.large") {
    res.status(413).json(formatErrorResponse("VALIDATION_ERROR", "Ảnh quá lớn. Hãy chọn ảnh JPEG/PNG dưới 4 MB."));
    return;
  }
  logger.error({ err }, "Unhandled error");
  res
    .status(500)
    .json(
      formatErrorResponse("INTERNAL_ERROR", "An unexpected error occurred"),
    );
});

export default app;
