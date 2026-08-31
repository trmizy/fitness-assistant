import serverless from "serverless-http";
import {
  ensureDatabaseUrlConfigured,
  validateRequiredRuntimeConfig,
} from "./config/lambda-runtime";

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
