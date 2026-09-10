/**
 * AWS Lambda HTTP entrypoint — API Gateway (HTTP API, payload format 2.0)
 * proxy integration in front of the SAME Express `app` used by the
 * container/local deployment (src/server.ts). No route/business-logic
 * changes: this file only adapts the API-Gateway-v2 event/response shape to
 * Express's req/res via `serverless-http`.
 *
 * Deliberately does NOT:
 *   - call app.listen() (Lambda owns the socket/lifecycle)
 *   - start the BullMQ ai.worker.ts Worker (a long-lived Redis consumer —
 *     see worker-lambda.ts for the Lambda-native equivalent)
 *   - start the personalized-service auto-accept setInterval sweep (see
 *     jobs-lambda.ts for the EventBridge-scheduled equivalent)
 *   - write to local disk outside /tmp
 *
 * Handler: dist/lambda.handler
 * API Gateway integration: HTTP API, payload format 2.0, proxy integration.
 *
 * Known limitation (see AWS deployment audit, section 8/21): POST
 * /ai/ask/stream uses chunked Server-Sent Events (res.write() in a loop).
 * API Gateway's Lambda proxy integration buffers the full Lambda response
 * before returning it to the client — it does NOT forward incremental
 * writes as a live stream. The route still works end-to-end (the client
 * receives the complete SSE payload in one shot instead of a live typing
 * effect), it just loses the incremental-token UX. True token-by-token
 * streaming on Lambda requires a Lambda Function URL with
 * InvokeMode=RESPONSE_STREAM, which is a separate integration from the
 * existing "fitness-assistant-dev-api" API Gateway and is out of scope for
 * this pass (no new AWS resources created here).
 */
import serverlessHttp from "serverless-http";
import {
  ensureDatabaseUrlConfigured,
  validateRequiredRuntimeConfig,
} from "./config/lambda-runtime";

// Lambda execution environments are frozen/thawed between invocations, so
// this runs at most once per cold start (module-level code), not per
// request — same intent as server.ts's startup check, adapted to not block
// the very first request on it. A cold start pays this once; a warm
// container reuses the cached result via qdrantAvailable's module state in
// app.ts (checked lazily below, not on a fixed interval — Lambda has no
// long-lived process to run setInterval against).
let qdrantCheckedAt = 0;
const QDRANT_RECHECK_MS = 60_000;

async function ensureQdrantChecked(): Promise<void> {
  const now = Date.now();
  if (now - qdrantCheckedAt < QDRANT_RECHECK_MS) return;
  qdrantCheckedAt = now;
  const { setQdrantAvailable } = await import("./app");
  const { getQdrantClient } = await import("./repositories/qdrant");
  try {
    await getQdrantClient().getCollections();
    setQdrantAvailable(true);
  } catch {
    setQdrantAvailable(false);
  }
}

let cachedHandler: ReturnType<typeof serverlessHttp> | null = null;

/**
 * `./app` is imported lazily, AFTER DATABASE_URL has been resolved from
 * Secrets Manager — importing it any earlier would pull in the Prisma client
 * (via the route/controller graph) while DATABASE_URL is still unset, which
 * Prisma rejects at construction time. Same ordering payment-service's
 * lambda.ts uses, and the reason this file has no top-level `import app`.
 */
async function getHandler() {
  if (!cachedHandler) {
    await ensureDatabaseUrlConfigured();
    validateRequiredRuntimeConfig();
    const { default: app } = await import("./app");
    cachedHandler = serverlessHttp(app, {
      provider: "aws",
      requestId: "x-request-id",
    });
  }
  return cachedHandler;
}

export const handler = async (event: unknown, context: unknown) => {
  const activeHandler = await getHandler();
  await ensureQdrantChecked();
  return activeHandler(event as never, context as never);
};
