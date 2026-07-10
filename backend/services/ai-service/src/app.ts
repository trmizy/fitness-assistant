import express, { Request, Response, NextFunction } from "express";
import { metricsMiddleware, register, logger } from "@gym-coach/shared";
import aiRoutes from "./routes/ai.routes";
import planRoutes from "./routes/plan.routes";
import adminAiRoutes from "./routes/admin.routes";
import internalRoutes from "./routes/internal.routes";
import { ApiError, formatErrorResponse } from "./errors/api-error";
import { llmService } from "./services/llm.service";

const app = express();

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
app.use("/admin/ai", adminAiRoutes);
app.use("/internal", internalRoutes);

// Global error handler.
// Must have 4 parameters so Express recognises it as an error-handling middleware.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json(err.toJSON());
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
