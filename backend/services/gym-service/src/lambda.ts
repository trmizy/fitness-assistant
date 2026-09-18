import serverless from "serverless-http";
import {
  ensureDatabaseUrlConfigured,
  validateRequiredRuntimeConfig,
} from "./config/lambda-runtime";

let cachedHandler: ReturnType<typeof serverless> | null = null;

async function getHandler() {
  if (!cachedHandler) {
    await ensureDatabaseUrlConfigured();
    validateRequiredRuntimeConfig();
    const { default: app } = await import("./app");
    cachedHandler = serverless(app, {
      provider: "aws",
      requestId: "x-request-id",
    });
  }
  return cachedHandler;
}

export async function handler(event: any, context: any) {
  const activeHandler = await getHandler();
  return activeHandler(event, context);
}

