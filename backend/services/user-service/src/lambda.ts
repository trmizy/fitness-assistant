import serverless from "serverless-http";
import {
  ensureDatabaseUrlConfigured,
  validateRequiredRuntimeConfig,
} from "./config/lambda-runtime";

// Structural port of auth-service/src/lambda.ts (already deployed and
// passing — docs/aws-deployment/04-backend-migration-plan.md). `app` is
// imported lazily, AFTER the DB secret is resolved into DATABASE_URL, so
// prisma/repositories/profile.repository.ts's `new PrismaClient()` (which
// reads DATABASE_URL at construction time) never runs before that env var
// exists. The cached handler is reused across warm invocations — same
// PrismaClient, same connection pool, no per-request $connect/$disconnect.
let cachedHandler: ReturnType<typeof serverless> | null = null;

async function getHandler(): Promise<ReturnType<typeof serverless>> {
  if (cachedHandler) return cachedHandler;

  await ensureDatabaseUrlConfigured();
  validateRequiredRuntimeConfig();

  const { default: app } = await import("./app");
  cachedHandler = serverless(app, {
    provider: "aws",
    requestId: "x-request-id",
  });

  return cachedHandler;
}

export async function handler(event: object, context: object) {
  const lambdaHandler = await getHandler();
  return lambdaHandler(event, context);
}
